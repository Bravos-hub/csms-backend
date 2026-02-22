import { Controller, Get } from '@nestjs/common';
import { KafkaService } from '../../platform/kafka.service';
import { PrismaService } from '../../prisma.service';
import { CommandEventsConsumer } from '../commands/command-events.consumer';

@Controller()
export class WorkerHealthController {
    constructor(
        private readonly kafka: KafkaService,
        private readonly prisma: PrismaService,
        private readonly commandEvents: CommandEventsConsumer,
    ) { }

    @Get('health/live')
    live() {
        return {
            status: 'ok',
            service: 'worker',
            time: new Date().toISOString(),
        };
    }

    @Get('health/ready')
    async ready() {
        const [db, kafka] = await Promise.all([
            this.checkDatabase(),
            this.kafka.checkConnection(),
        ]);
        const consumerReady = this.commandEvents.isReady();
        const status = db.status === 'up' && kafka.status === 'up' && consumerReady ? 'ok' : 'degraded';

        return {
            status,
            service: 'worker',
            time: new Date().toISOString(),
            db,
            kafka: {
                ...kafka,
                producerConnected: this.kafka.isConnected(),
                commandEventsConsumerReady: consumerReady,
                commandEventsConsumerRunning: this.commandEvents.isRunning(),
            },
        };
    }

    private async checkDatabase(): Promise<{ status: 'up' | 'down'; error?: string }> {
        try {
            await this.prisma.$queryRawUnsafe('SELECT 1');
            return { status: 'up' };
        } catch (error) {
            return {
                status: 'down',
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }
}


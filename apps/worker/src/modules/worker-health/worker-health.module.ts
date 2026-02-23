import { Module } from '@nestjs/common';
import { WorkerHealthController } from './worker-health.controller';
import { CommandsWorkerModule } from '../commands/commands-worker.module';
import { KafkaModule } from '../../platform/kafka.module';

@Module({
    imports: [CommandsWorkerModule, KafkaModule],
    controllers: [WorkerHealthController],
})
export class WorkerHealthModule { }


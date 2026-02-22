import { Controller, Get } from '@nestjs/common';
import { KafkaService } from '../../platform/kafka.service';
import { PrismaService } from '../../prisma.service';
import { CommandEventsConsumer } from '../commands/command-events.consumer';
import { WorkerMetricsService } from '../observability/worker-metrics.service';

@Controller()
export class WorkerHealthController {
  constructor(
    private readonly kafka: KafkaService,
    private readonly prisma: PrismaService,
    private readonly commandEvents: CommandEventsConsumer,
    private readonly metrics: WorkerMetricsService,
  ) {}

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
    const [db, kafka, outbox] = await Promise.all([
      this.checkDatabase(),
      this.kafka.checkConnection(),
      this.checkOutboxReadiness(),
    ]);
    const consumerReady = this.commandEvents.isReady();
    const status =
      db.status === 'up' &&
      kafka.status === 'up' &&
      consumerReady &&
      outbox.status === 'ok'
        ? 'ok'
        : 'degraded';

    return {
      status,
      service: 'worker',
      time: new Date().toISOString(),
      db,
      outbox,
      kafka: {
        ...kafka,
        producerConnected: this.kafka.isConnected(),
        commandEventsConsumerReady: consumerReady,
        commandEventsConsumerRunning: this.commandEvents.isRunning(),
      },
    };
  }

  @Get('metrics')
  getMetrics() {
    return this.metrics.snapshot();
  }

  @Get('health/metrics')
  getHealthMetrics() {
    return this.metrics.snapshot();
  }

  private async checkDatabase(): Promise<{
    status: 'up' | 'down';
    error?: string;
  }> {
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

  private async checkOutboxReadiness(): Promise<{
    status: 'ok' | 'degraded';
    backlogDepth: number;
    oldestQueuedAgeSec: number;
    maxBacklogThreshold: number;
    maxOldestAgeThresholdSec: number;
  }> {
    const maxBacklogThreshold = this.readIntEnv(
      'OUTBOX_READY_MAX_BACKLOG',
      10000,
    );
    const maxOldestAgeThresholdSec = this.readIntEnv(
      'OUTBOX_READY_MAX_OLDEST_AGE_SEC',
      600,
    );

    const [backlogDepth, oldestQueued] = await Promise.all([
      this.prisma.commandOutbox.count({
        where: { status: 'Queued' },
      }),
      this.prisma.commandOutbox.findFirst({
        where: { status: 'Queued' },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
    ]);

    const oldestQueuedAgeSec = oldestQueued
      ? Math.max(
          0,
          Math.floor((Date.now() - oldestQueued.createdAt.getTime()) / 1000),
        )
      : 0;

    const status =
      backlogDepth > maxBacklogThreshold ||
      oldestQueuedAgeSec > maxOldestAgeThresholdSec
        ? 'degraded'
        : 'ok';

    this.metrics.setGauge('outbox_backlog_depth', backlogDepth);
    this.metrics.setGauge(
      'outbox_oldest_queued_age_seconds',
      oldestQueuedAgeSec,
    );

    return {
      status,
      backlogDepth,
      oldestQueuedAgeSec,
      maxBacklogThreshold,
      maxOldestAgeThresholdSec,
    };
  }

  private readIntEnv(key: string, fallback: number): number {
    const raw = process.env[key];
    if (!raw) return fallback;
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
}

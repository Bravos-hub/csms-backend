import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { KAFKA_TOPICS } from '../../contracts/kafka-topics';
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
  async ready(@Res({ passthrough: true }) response: Response) {
    const report = await this.buildReadinessReport();
    const status = report.status;
    response.status(
      status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE,
    );

    return {
      status,
      service: 'worker',
      time: new Date().toISOString(),
      db: report.db,
      outbox: report.outbox,
      kafka: {
        ...report.kafka,
        producerConnected: report.producerConnected,
        commandEventsConsumerReady: report.consumerReady,
        commandEventsConsumerRunning: this.commandEvents.isRunning(),
        commandEventsConsumerLag: report.consumerLag,
      },
    };
  }

  @Get('health')
  async health(@Res({ passthrough: true }) response: Response) {
    return this.ready(response);
  }

  @Get('metrics')
  getMetrics() {
    return {
      ...this.metrics.snapshot(),
      dbPool: this.prisma.getPoolMetrics(),
    };
  }

  @Get('health/metrics')
  getHealthMetrics() {
    return {
      ...this.metrics.snapshot(),
      dbPool: this.prisma.getPoolMetrics(),
    };
  }

  @Get('metrics/prometheus')
  async prometheus(@Res() response: Response) {
    const report = await this.buildReadinessReport();
    const dbPool = this.prisma.getPoolMetrics();
    const lines = [
      '# TYPE worker_health_ready_status gauge',
      `worker_health_ready_status ${report.status === 'ok' ? 1 : 0}`,
      '# TYPE worker_dependency_status gauge',
      `worker_dependency_status{name="db"} ${report.db.status === 'up' ? 1 : 0}`,
      `worker_dependency_status{name="kafka"} ${report.kafka.status === 'up' ? 1 : 0}`,
      '# TYPE worker_db_pool_total_count gauge',
      `worker_db_pool_total_count ${dbPool.totalCount}`,
      '# TYPE worker_db_pool_idle_count gauge',
      `worker_db_pool_idle_count ${dbPool.idleCount}`,
      '# TYPE worker_db_pool_waiting_count gauge',
      `worker_db_pool_waiting_count ${dbPool.waitingCount}`,
      '# TYPE worker_db_pool_max_count gauge',
      `worker_db_pool_max_count ${dbPool.max ?? 0}`,
      ...this.metrics.toPrometheusLines(),
    ];

    response.setHeader(
      'Content-Type',
      'text/plain; version=0.0.4; charset=utf-8',
    );
    response.send(`${lines.join('\n')}\n`);
  }

  private async checkDatabase(): Promise<{
    status: 'up' | 'down';
    pool: {
      totalCount: number;
      idleCount: number;
      waitingCount: number;
      max: number | null;
    };
    error?: string;
  }> {
    const pool = this.prisma.getPoolMetrics();
    try {
      await this.prisma.$queryRawUnsafe('SELECT 1');
      return { status: 'up', pool };
    } catch (error) {
      return {
        status: 'down',
        pool,
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

  private async checkConsumerLagReadiness(): Promise<{
    status: 'ok' | 'degraded';
    enabled: boolean;
    threshold: number;
    totalLag: number;
    partitions: Array<{
      partition: number;
      committedOffset: number;
      latestOffset: number;
      lag: number;
    }>;
    error?: string;
  }> {
    const threshold = this.readIntEnv('WORKER_READY_MAX_CONSUMER_LAG', 1000);

    if (!this.commandEvents.isEnabled()) {
      return {
        status: 'ok',
        enabled: false,
        threshold,
        totalLag: 0,
        partitions: [],
      };
    }

    const groupId = this.commandEvents.getGroupId();
    if (!groupId) {
      return {
        status: 'degraded',
        enabled: true,
        threshold,
        totalLag: 0,
        partitions: [],
        error: 'Command events consumer group not initialized',
      };
    }

    const lag = await this.kafka.getConsumerLag(
      groupId,
      KAFKA_TOPICS.commandEvents,
    );
    if (lag.status === 'down') {
      return {
        status: 'degraded',
        enabled: true,
        threshold,
        totalLag: 0,
        partitions: [],
        error: lag.error,
      };
    }

    this.metrics.setGauge('command_events_consumer_lag_total', lag.totalLag);
    const status = lag.totalLag > threshold ? 'degraded' : 'ok';
    return {
      status,
      enabled: true,
      threshold,
      totalLag: lag.totalLag,
      partitions: lag.partitions,
    };
  }

  private async buildReadinessReport() {
    const [db, kafka, outbox, consumerLag] = await Promise.all([
      this.checkDatabase(),
      this.kafka.checkConnection(),
      this.checkOutboxReadiness(),
      this.checkConsumerLagReadiness(),
    ]);
    const consumerReady = this.commandEvents.isReady();
    const producerConnected = this.kafka.isConnected();
    const status =
      db.status === 'up' &&
      kafka.status === 'up' &&
      consumerReady &&
      outbox.status === 'ok' &&
      consumerLag.status === 'ok'
        ? 'ok'
        : 'degraded';

    return {
      status,
      db,
      kafka,
      outbox,
      consumerLag,
      consumerReady,
      producerConnected,
    };
  }
}

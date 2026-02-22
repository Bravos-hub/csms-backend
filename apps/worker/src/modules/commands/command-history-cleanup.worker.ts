import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma.service';
import { WorkerMetricsService } from '../observability/worker-metrics.service';

@Injectable()
export class CommandHistoryCleanupWorker
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(CommandHistoryCleanupWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly metrics: WorkerMetricsService,
  ) {}

  async onModuleInit(): Promise<void> {
    const enabled = this.getBoolean('COMMAND_HISTORY_CLEANUP_ENABLED', true);
    if (!enabled) {
      this.logger.log('Command history cleanup disabled');
      return;
    }

    const intervalMs = this.getInt(
      'COMMAND_HISTORY_CLEANUP_INTERVAL_MS',
      60 * 60 * 1000,
    );
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);

    await this.tick();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private getBoolean(key: string, fallback: boolean): boolean {
    const raw = this.config.get<string>(key);
    if (!raw) return fallback;
    return raw.trim().toLowerCase() === 'true';
  }

  private getInt(key: string, fallback: number): number {
    const raw = this.config.get<string>(key);
    if (!raw) return fallback;
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const startedAt = Date.now();

    try {
      const retentionDays = this.getInt('COMMAND_HISTORY_RETENTION_DAYS', 30);
      const batchSize = this.getInt('COMMAND_HISTORY_CLEANUP_BATCH_SIZE', 1000);
      const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

      const [deletedEvents, deletedOutbox] = await Promise.all([
        this.deleteOldCommandEvents(cutoff, batchSize),
        this.deleteOldOutboxRows(cutoff, batchSize),
      ]);

      this.metrics.increment('command_history_cleanup_runs_total');
      this.metrics.increment(
        'command_history_cleanup_deleted_events_total',
        deletedEvents,
      );
      this.metrics.increment(
        'command_history_cleanup_deleted_outbox_total',
        deletedOutbox,
      );
      this.metrics.observeLatency(
        'command_history_cleanup_latency_ms',
        Date.now() - startedAt,
      );

      this.logger.log(
        `Command history cleanup completed (events=${deletedEvents}, outbox=${deletedOutbox}, cutoff=${cutoff.toISOString()})`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.metrics.increment('command_history_cleanup_fail_total');
      this.logger.error(`Command history cleanup failed: ${message}`);
    } finally {
      this.running = false;
    }
  }

  private async deleteOldCommandEvents(
    cutoff: Date,
    batchSize: number,
  ): Promise<number> {
    const ids = await this.prisma.commandEvent.findMany({
      where: {
        occurredAt: { lt: cutoff },
      },
      orderBy: { occurredAt: 'asc' },
      take: batchSize,
      select: { id: true },
    });

    if (ids.length === 0) return 0;

    const result = await this.prisma.commandEvent.deleteMany({
      where: {
        id: { in: ids.map((entry) => entry.id) },
      },
    });
    return result.count;
  }

  private async deleteOldOutboxRows(
    cutoff: Date,
    batchSize: number,
  ): Promise<number> {
    const ids = await this.prisma.commandOutbox.findMany({
      where: {
        status: { in: ['Published', 'DeadLettered'] },
        updatedAt: { lt: cutoff },
      },
      orderBy: { updatedAt: 'asc' },
      take: batchSize,
      select: { id: true },
    });

    if (ids.length === 0) return 0;

    const result = await this.prisma.commandOutbox.deleteMany({
      where: {
        id: { in: ids.map((entry) => entry.id) },
      },
    });
    return result.count;
  }
}

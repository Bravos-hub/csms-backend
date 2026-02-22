import { Command, CommandOutbox } from '@prisma/client';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma.service';
import { KafkaService } from '../../platform/kafka.service';
import { KAFKA_TOPICS } from '../../contracts/kafka-topics';
import { CommandRequest } from '../../contracts/commands';
import { WorkerMetricsService } from '../observability/worker-metrics.service';

@Injectable()
export class CommandOutboxWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CommandOutboxWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly kafka: KafkaService,
    private readonly metrics: WorkerMetricsService,
  ) {}

  async onModuleInit(): Promise<void> {
    const enabled = this.getBoolean('OUTBOX_ENABLED', true);
    if (!enabled) {
      this.logger.log('Command outbox worker disabled');
      return;
    }

    const intervalMs = this.getInt('OUTBOX_INTERVAL_MS', 2000);
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
      const batch = await this.claimBatch();
      this.metrics.increment('outbox_claimed_total', batch.length);
      this.metrics.setGauge('outbox_claimed_last_batch', batch.length);
      this.metrics.setGauge('outbox_processing_active', 1);

      for (const item of batch) {
        await this.publish(item);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Outbox worker tick failed: ${message}`);
      this.metrics.increment('outbox_tick_fail_total');
    } finally {
      this.running = false;
      this.metrics.setGauge('outbox_processing_active', 0);
      this.metrics.observeLatency(
        'outbox_tick_latency_ms',
        Date.now() - startedAt,
      );
      try {
        await this.refreshBacklogMetrics();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Failed to refresh backlog metrics: ${message}`);
        this.metrics.increment('outbox_metrics_refresh_fail_total');
      }
    }
  }

  private async claimBatch(): Promise<CommandOutbox[]> {
    const batchSize = this.getInt('OUTBOX_BATCH_SIZE', 50);
    const lockTtlMs = this.getInt('OUTBOX_LOCK_TTL_MS', 60000);
    const retryBackoffMs = this.getInt('OUTBOX_RETRY_BACKOFF_MS', 5000);
    const staleTime = new Date(Date.now() - lockTtlMs);
    const retryCutoff = new Date(Date.now() - retryBackoffMs);
    const now = new Date();

    const candidates = await this.prisma.commandOutbox.findMany({
      where: {
        status: 'Queued',
        AND: [
          {
            OR: [{ lockedAt: null }, { lockedAt: { lt: staleTime } }],
          },
          {
            OR: [{ attempts: 0 }, { updatedAt: { lt: retryCutoff } }],
          },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: batchSize,
    });

    if (candidates.length === 0) return [];

    const lockedItems: CommandOutbox[] = [];

    for (const candidate of candidates) {
      const result = await this.prisma.commandOutbox.updateMany({
        where: {
          id: candidate.id,
          status: 'Queued',
          OR: [{ lockedAt: null }, { lockedAt: { lt: staleTime } }],
        },
        data: {
          lockedAt: now,
          attempts: { increment: 1 },
          updatedAt: now,
        },
      });

      if (result.count > 0) {
        lockedItems.push({
          ...candidate,
          lockedAt: now,
          attempts: candidate.attempts + 1,
          updatedAt: now,
        });
      }
    }

    return lockedItems;
  }

  private async publish(outbox: CommandOutbox): Promise<void> {
    const command = await this.prisma.command.findUnique({
      where: { id: outbox.commandId },
    });
    if (!command) {
      await this.handlePublishFailure(outbox, 'Command not found');
      return;
    }

    const targetOcppId = await this.resolveTargetOcppId(command, outbox);
    if (!targetOcppId) {
      return;
    }

    const request: CommandRequest = {
      commandId: command.id,
      commandType: command.commandType,
      stationId: command.stationId || undefined,
      chargePointId: targetOcppId,
      connectorId: command.connectorId
        ? Number(command.connectorId)
        : undefined,
      payload: (command.payload as Record<string, unknown>) || {},
      requestedBy: command.requestedBy
        ? { userId: command.requestedBy }
        : undefined,
      requestedAt: command.requestedAt.toISOString(),
    };

    try {
      const now = new Date();
      await this.kafka.publish(
        KAFKA_TOPICS.commandRequests,
        JSON.stringify(request),
        targetOcppId,
      );
      this.metrics.increment('outbox_publish_success_total');
      this.metrics.observeLatency(
        'outbox_enqueue_to_dispatch_ms',
        now.getTime() - command.requestedAt.getTime(),
      );

      await this.prisma.$transaction(async (tx) => {
        await tx.commandOutbox.update({
          where: { id: outbox.id },
          data: {
            status: 'Published',
            publishedAt: now,
            updatedAt: now,
            lockedAt: null,
            lastError: null,
          },
        });
        await tx.command.update({
          where: { id: command.id },
          data: {
            status: 'Sent',
            sentAt: now,
            error: null,
          },
        });
        await tx.commandEvent.create({
          data: {
            commandId: command.id,
            status: 'Sent',
            payload: { commandType: command.commandType },
            occurredAt: now,
          },
        });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Publish failed';
      this.metrics.increment('outbox_publish_fail_total');
      await this.handlePublishFailure(outbox, message);
    }
  }

  private async resolveTargetOcppId(
    command: Command,
    outbox: CommandOutbox,
  ): Promise<string | null> {
    if (!command.chargePointId && !command.stationId) {
      await this.handlePublishFailure(
        outbox,
        'Missing chargePointId or stationId',
      );
      return null;
    }

    let targetOcppId = command.chargePointId;
    if (command.chargePointId) {
      const cp = await this.prisma.chargePoint.findUnique({
        where: { id: command.chargePointId },
      });
      if (!cp) {
        await this.handlePublishFailure(outbox, 'ChargePoint not found');
        return null;
      }
      targetOcppId = cp.ocppId;
    }

    if (!targetOcppId) {
      await this.handlePublishFailure(outbox, 'Unable to resolve OCPP ID');
      return null;
    }

    return targetOcppId;
  }

  private async handlePublishFailure(
    outbox: CommandOutbox,
    message: string,
  ): Promise<void> {
    const maxAttempts = this.getInt('OUTBOX_MAX_ATTEMPTS', 5);
    const now = new Date();
    const exhausted = outbox.attempts >= maxAttempts;

    if (exhausted) {
      this.metrics.increment('outbox_dead_letter_total');
      await this.moveToDeadLetter(outbox, message, now);
      return;
    }

    this.metrics.increment('outbox_retry_scheduled_total');

    await this.prisma.$transaction(async (tx) => {
      await tx.commandOutbox.update({
        where: { id: outbox.id },
        data: {
          status: 'Queued',
          updatedAt: now,
          lockedAt: null,
          lastError: message,
        },
      });
      await tx.commandEvent.create({
        data: {
          commandId: outbox.commandId,
          status: 'RetryScheduled',
          payload: { error: message, attempts: outbox.attempts },
          occurredAt: now,
        },
      });
    });
  }

  private async moveToDeadLetter(
    outbox: CommandOutbox,
    message: string,
    now: Date,
  ): Promise<void> {
    const payload = {
      outboxId: outbox.id,
      commandId: outbox.commandId,
      attempts: outbox.attempts,
      error: message,
      occurredAt: now.toISOString(),
    };

    await this.prisma.$transaction(async (tx) => {
      await tx.commandOutbox.update({
        where: { id: outbox.id },
        data: {
          status: 'DeadLettered',
          updatedAt: now,
          lockedAt: null,
          lastError: message,
        },
      });
      await tx.command.update({
        where: { id: outbox.commandId },
        data: {
          status: 'Failed',
          completedAt: now,
          error: message,
        },
      });
      await tx.commandEvent.create({
        data: {
          commandId: outbox.commandId,
          status: 'DeadLettered',
          payload,
          occurredAt: now,
        },
      });
    });

    try {
      await this.kafka.publish(
        KAFKA_TOPICS.commandDeadLetters,
        JSON.stringify(payload),
        outbox.commandId,
      );
    } catch (error) {
      const kafkaError = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to publish dead-letter message for command ${outbox.commandId}: ${kafkaError}`,
      );
      this.metrics.increment('outbox_dead_letter_publish_fail_total');
    }
  }

  private async refreshBacklogMetrics(): Promise<void> {
    const queuedCount = await this.prisma.commandOutbox.count({
      where: { status: 'Queued' },
    });

    const oldestQueued = await this.prisma.commandOutbox.findFirst({
      where: { status: 'Queued' },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });

    const oldestAgeSeconds = oldestQueued
      ? Math.max(
          0,
          Math.floor((Date.now() - oldestQueued.createdAt.getTime()) / 1000),
        )
      : 0;

    this.metrics.setGauge('outbox_backlog_depth', queuedCount);
    this.metrics.setGauge('outbox_oldest_queued_age_seconds', oldestAgeSeconds);
  }
}

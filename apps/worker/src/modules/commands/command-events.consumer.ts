import { Prisma } from '@prisma/client';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma.service';
import { KafkaService } from '../../platform/kafka.service';
import { DomainEvent } from '../../contracts/commands';
import { KAFKA_TOPICS } from '../../contracts/kafka-topics';
import { WorkerMetricsService } from '../observability/worker-metrics.service';
import {
  CommandStatus,
  isTerminalStatus,
  mapEventTypeToCommandStatus,
  resolveNextStatus,
} from './command-status';

@Injectable()
export class CommandEventsConsumer implements OnModuleInit {
  private readonly logger = new Logger(CommandEventsConsumer.name);
  private subscribed = false;
  private running = false;
  private enabled = true;
  private groupId: string | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly kafka: KafkaService,
    private readonly metrics: WorkerMetricsService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.enabled = this.getBoolean('WORKER_COMMAND_EVENTS_ENABLED', true);
    if (!this.enabled) {
      this.logger.log('Command events consumer disabled');
      return;
    }

    const groupId =
      this.config.get<string>('WORKER_COMMAND_EVENT_GROUP_ID') ||
      'evzone-worker-command-events';
    this.groupId = groupId;
    const consumer = await this.kafka.getConsumer(groupId);
    await consumer.subscribe({
      topic: KAFKA_TOPICS.commandEvents,
      fromBeginning: false,
    });
    this.subscribed = true;

    void consumer
      .run({
        eachMessage: async ({ message }) => {
          this.running = true;
          this.metrics.increment('command_events_received_total');
          try {
            const value = message.value?.toString();
            if (!value) return;
            const parsed = this.parseDomainEvent(value);
            if (!parsed.ok) {
              this.logger.warn(
                `Rejected invalid command event payload: ${parsed.reason}`,
              );
              this.metrics.increment('command_events_invalid_total');
              return;
            }
            const event = parsed.event;
            const result = await this.reconcileEvent(event);
            if (result.applied) {
              this.metrics.increment('command_events_applied_total');
              if (result.status) {
                this.metrics.increment(
                  `command_status_transition_${result.status.toLowerCase()}_total`,
                );
              }
              if (result.enqueueToFinalMs !== undefined) {
                this.metrics.observeLatency(
                  'command_enqueue_to_final_ms',
                  result.enqueueToFinalMs,
                );
              }
            } else {
              this.metrics.increment('command_events_skipped_total');
            }
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            this.logger.error(`Command event processing failed: ${msg}`);
            this.metrics.increment('command_events_failed_total');
          } finally {
            this.running = false;
          }
        },
      })
      .catch((error) => {
        this.subscribed = false;
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.error(`Command events consumer failed: ${msg}`);
        this.metrics.increment('command_events_consumer_crash_total');
      });
  }

  isReady(): boolean {
    if (!this.enabled) return true;
    return this.subscribed;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getGroupId(): string | null {
    return this.groupId;
  }

  isRunning(): boolean {
    if (!this.enabled) return true;
    return this.running || this.subscribed;
  }

  private parseDomainEvent(
    raw: string,
  ): { ok: true; event: DomainEvent } | { ok: false; reason: string } {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, reason: 'Invalid JSON' };
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, reason: 'Event payload must be an object' };
    }

    const candidate = parsed as Record<string, unknown>;
    const eventId = candidate.eventId;
    const eventType = candidate.eventType;
    const source = candidate.source;
    const occurredAt = candidate.occurredAt;
    const payload = candidate.payload;

    if (typeof eventId !== 'string' || eventId.trim().length === 0) {
      return { ok: false, reason: 'eventId is required' };
    }
    if (typeof eventType !== 'string' || eventType.trim().length === 0) {
      return { ok: false, reason: 'eventType is required' };
    }
    if (typeof source !== 'string' || source.trim().length === 0) {
      return { ok: false, reason: 'source is required' };
    }
    if (
      typeof occurredAt !== 'string' ||
      Number.isNaN(Date.parse(occurredAt))
    ) {
      return { ok: false, reason: 'occurredAt must be an ISO date string' };
    }
    if (
      payload !== undefined &&
      (payload === null ||
        typeof payload !== 'object' ||
        Array.isArray(payload))
    ) {
      return { ok: false, reason: 'payload must be an object when provided' };
    }

    return { ok: true, event: candidate as DomainEvent };
  }

  private getBoolean(key: string, fallback: boolean): boolean {
    const raw = this.config.get<string>(key);
    if (!raw) return fallback;
    return raw.trim().toLowerCase() === 'true';
  }

  private async reconcileEvent(event: DomainEvent): Promise<{
    applied: boolean;
    status?: CommandStatus;
    enqueueToFinalMs?: number;
  }> {
    const commandId = event.correlationId;
    if (!commandId) {
      this.logger.warn('Received command event without correlationId');
      return { applied: false };
    }

    const mappedStatus = mapEventTypeToCommandStatus(event.eventType);
    if (!mappedStatus) {
      return { applied: false };
    }

    const occurredAt = this.parseOccurredAt(event.occurredAt);
    let applied = false;
    let enqueueToFinalMs: number | undefined;

    await this.prisma.$transaction(async (tx) => {
      const command = await tx.command.findUnique({
        where: { id: commandId },
        select: {
          id: true,
          status: true,
          sentAt: true,
          completedAt: true,
          requestedAt: true,
        },
      });
      if (!command) {
        this.logger.warn(
          `Command not found for event correlationId=${commandId}`,
        );
        return;
      }

      if (command.status === mappedStatus && isTerminalStatus(mappedStatus)) {
        return;
      }

      const existing = await tx.commandEvent.findFirst({
        where: {
          commandId,
          status: mappedStatus,
          occurredAt,
        },
        select: { id: true },
      });
      if (existing) {
        return;
      }

      const nextStatus = resolveNextStatus(command.status, mappedStatus);
      if (!nextStatus) {
        return;
      }

      const errorMessage = this.extractErrorMessage(event);
      const commandUpdate: {
        status: CommandStatus;
        error?: string | null;
        sentAt?: Date;
        completedAt?: Date;
      } = {
        status: nextStatus,
      };

      if (nextStatus === 'Sent' && !command.sentAt) {
        commandUpdate.sentAt = occurredAt;
      }

      if (isTerminalStatus(nextStatus) && !command.completedAt) {
        commandUpdate.completedAt = occurredAt;
      }

      if (errorMessage) {
        commandUpdate.error = errorMessage;
      } else if (nextStatus === 'Accepted') {
        commandUpdate.error = null;
      }

      await tx.command.update({
        where: { id: commandId },
        data: commandUpdate,
      });
      await tx.commandEvent.create({
        data: {
          commandId,
          status: nextStatus,
          payload: event as unknown as Prisma.InputJsonValue,
          occurredAt,
        },
      });

      applied = true;
      if (isTerminalStatus(nextStatus)) {
        enqueueToFinalMs = Math.max(
          0,
          occurredAt.getTime() - command.requestedAt.getTime(),
        );
      }
    });

    return {
      applied,
      status: applied ? mappedStatus : undefined,
      enqueueToFinalMs,
    };
  }

  private parseOccurredAt(value: string): Date {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return new Date();
    }
    return parsed;
  }

  private extractErrorMessage(event: DomainEvent): string | null {
    const payload = event.payload || {};
    const maybeError = payload.error;
    if (typeof maybeError === 'string' && maybeError.trim().length > 0) {
      return maybeError;
    }
    return null;
  }
}

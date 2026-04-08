import { Prisma } from '@prisma/client';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma.service';
import { KafkaService } from '../../platform/kafka.service';
import {
  DomainEvent,
  validateDomainEventContract,
} from '../../contracts/commands';
import { KAFKA_TOPICS } from '../../contracts/kafka-topics';
import { WorkerMetricsService } from '../observability/worker-metrics.service';
import {
  CommandStatus,
  isTerminalStatus,
  mapEventTypeToCommandStatus,
  resolveNextStatus,
} from './command-status';
import { OcpiCommandCallbackService } from './ocpi-command-callback.service';

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
    private readonly ocpiCallbacks: OcpiCommandCallbackService,
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
              if (result.callback) {
                await this.ocpiCallbacks.deliver(result.callback);
              }
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

    const validation = validateDomainEventContract(parsed);
    if (!validation.ok) {
      return { ok: false, reason: validation.reason };
    }
    return { ok: true, event: validation.value };
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
    callback?: {
      commandId: string;
      requestId: string;
      command: string;
      responseUrl: string;
      partnerId?: string | null;
      status: string;
      error?: string | null;
    };
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
    let callback:
      | {
          commandId: string;
          requestId: string;
          command: string;
          responseUrl: string;
          partnerId?: string | null;
          status: string;
          error?: string | null;
        }
      | undefined;

    await this.prisma.$transaction(async (tx) => {
      const command = await tx.command.findUnique({
        where: { id: commandId },
        select: {
          id: true,
          status: true,
          sentAt: true,
          completedAt: true,
          requestedAt: true,
          payload: true,
          commandType: true,
          correlationId: true,
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
      const payload = this.ensureObject(command.payload);
      const ocpi = this.ensureObject(payload.ocpi);
      const commandUpdate: {
        status: CommandStatus;
        error?: string | null;
        sentAt?: Date;
        completedAt?: Date;
        payload?: Prisma.InputJsonValue;
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

      if (isTerminalStatus(nextStatus)) {
        commandUpdate.payload = {
          ...payload,
          ocpi: {
            ...ocpi,
            lastCommandStatus: nextStatus,
            lastCommandStatusAt: occurredAt.toISOString(),
          },
        } as Prisma.InputJsonValue;

        const responseUrl = this.extractString(ocpi, 'responseUrl');
        if (responseUrl) {
          callback = {
            commandId: command.id,
            requestId:
              this.extractString(ocpi, 'requestId') ||
              command.correlationId ||
              command.id,
            command: this.extractString(ocpi, 'command') || command.commandType,
            responseUrl,
            partnerId: this.extractString(ocpi, 'partnerId'),
            status: nextStatus,
            error: errorMessage,
          };
        }
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

      await this.syncBookingReservationState(tx, {
        commandId: command.id,
        commandType: command.commandType,
        status: nextStatus,
        correlationId: command.correlationId || null,
        payload,
        errorMessage,
        occurredAt,
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
      callback,
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

  private ensureObject(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }

  private extractString(
    source: Record<string, unknown>,
    key: string,
  ): string | null {
    const value = source[key];
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private async syncBookingReservationState(
    tx: Prisma.TransactionClient,
    input: {
      commandId: string;
      commandType: string;
      status: CommandStatus;
      correlationId: string | null;
      payload: Record<string, unknown>;
      errorMessage: string | null;
      occurredAt: Date;
    },
  ): Promise<void> {
    const normalizedCommandType = this.normalizeCommandType(input.commandType);
    if (
      normalizedCommandType !== 'RESERVE_NOW' &&
      normalizedCommandType !== 'CANCEL_RESERVATION'
    ) {
      return;
    }

    const reservationId = this.extractReservationId(input.payload);
    if (!reservationId) return;

    const booking = await tx.booking.findFirst({
      where: { reservationId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
      },
    });
    if (!booking) return;

    const bookingUpdate: Prisma.BookingUpdateInput = {
      reservationCommandId: input.commandId,
      reservationCommandStatus: input.status,
      reservationCommandUpdatedAt: input.occurredAt,
      ...(input.correlationId
        ? { commandCorrelationId: input.correlationId }
        : {}),
    };

    if (normalizedCommandType === 'RESERVE_NOW') {
      if (
        input.status === 'Rejected' ||
        input.status === 'Failed' ||
        input.status === 'Timeout' ||
        input.status === 'Duplicate'
      ) {
        if (booking.status !== 'CANCELLED') {
          bookingUpdate.status = 'CANCELLED';
        }
        bookingUpdate.cancelledAt = input.occurredAt;
        bookingUpdate.autoCancelReason =
          input.errorMessage || `Reserve command ${input.status.toLowerCase()}`;
      }
    }

    if (normalizedCommandType === 'CANCEL_RESERVATION') {
      if (input.status === 'Accepted' && booking.status !== 'CANCELLED') {
        bookingUpdate.status = 'CANCELLED';
        bookingUpdate.cancelledAt = input.occurredAt;
        bookingUpdate.autoCancelReason =
          input.errorMessage || 'Cancelled by reservation command';
      }
    }

    await tx.booking.update({
      where: { id: booking.id },
      data: bookingUpdate,
    });

    await tx.bookingEvent.create({
      data: {
        bookingId: booking.id,
        eventType: `${normalizedCommandType}_${input.status.toUpperCase()}`,
        source: 'worker.command.event',
        status: input.status,
        occurredAt: input.occurredAt,
        details: {
          commandId: input.commandId,
          correlationId: input.correlationId,
          error: input.errorMessage,
        } as Prisma.InputJsonValue,
      },
    });
  }

  private normalizeCommandType(commandType: string): string {
    return commandType
      .trim()
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .replace(/[\s-]+/g, '_')
      .toUpperCase();
  }

  private extractReservationId(
    payload: Record<string, unknown>,
  ): number | null {
    const direct = this.readNumber(payload.reservationId ?? payload.id);
    if (direct) return direct;

    const ocpi = this.ensureObject(payload.ocpi);
    const originalRequest = this.ensureObject(ocpi.originalRequest);
    return this.readNumber(
      originalRequest.reservation_id ??
        originalRequest.reservationId ??
        originalRequest.id,
    );
  }

  private readNumber(value: unknown): number | null {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    const normalized = Math.floor(parsed);
    return normalized > 0 ? normalized : null;
  }
}

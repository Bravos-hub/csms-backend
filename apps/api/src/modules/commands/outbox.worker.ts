import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KafkaService } from '../../platform/kafka.service';
import { PrismaService } from '../../prisma.service';
import { CommandOutbox } from '@prisma/client';

@Injectable()
export class CommandOutboxWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CommandOutboxWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly kafka: KafkaService,
  ) { }

  async onModuleInit(): Promise<void> {
    const enabled = this.config.get<boolean>('outbox.enabled', true);
    if (!enabled) {
      this.logger.log('Command outbox worker disabled');
      return;
    }

    const intervalMs = this.config.get<number>('outbox.intervalMs') || 5000;
    this.timer = setInterval(() => this.tick(), intervalMs);
    await this.tick();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const batch = await this.claimBatch();
      for (const item of batch) {
        await this.publish(item);
      }
    } catch (error) {
      this.logger.error('Outbox worker error', error as Error);
    } finally {
      this.running = false;
    }
  }

  private async claimBatch(): Promise<CommandOutbox[]> {
    const batchSize = this.config.get<number>('outbox.batchSize') || 50;
    const lockTtlMs = this.config.get<number>('outbox.lockTtlMs') || 60000;
    const staleTime = new Date(Date.now() - lockTtlMs);
    const now = new Date();

    // Find candidates
    // Note: Prisma doesn't support 'SKIP LOCKED' natively easily without queryRaw.
    // We will use a find-then-update optimist lock pattern for simplicity in this migration.
    try {
      const candidates = await this.prisma.commandOutbox.findMany({
        where: {
          status: 'Queued',
          OR: [
            { lockedAt: null },
            { lockedAt: { lt: staleTime } }
          ]
        },
        orderBy: { createdAt: 'asc' },
        take: batchSize
      });

      if (candidates.length === 0) return [];

      const lockedItems: CommandOutbox[] = [];

      for (const candidate of candidates) {
        // Try to lock
        const result = await this.prisma.commandOutbox.updateMany({
          where: {
            id: candidate.id,
            // Ensure it's still claimable
            OR: [
              { lockedAt: null },
              { lockedAt: candidate.lockedAt } // Matches what we found
            ]
          },
          data: {
            lockedAt: now,
            attempts: { increment: 1 },
            updatedAt: now
          }
        });

        if (result.count > 0) {
          lockedItems.push({ ...candidate, lockedAt: now, attempts: candidate.attempts + 1, updatedAt: now });
        }
      }

      return lockedItems;
    } catch (error) {
      this.logger.error('Claim batch failed', error);
      return [];
    }
  }

  private async publish(outbox: CommandOutbox): Promise<void> {
    const command = await this.prisma.command.findUnique({ where: { id: outbox.commandId } });
    if (!command) {
      await this.failOutbox(outbox, 'Command not found');
      return;
    }

    if (!command.chargePointId && !command.stationId) {
      await this.failOutbox(outbox, 'Missing chargePointId or stationId');
      return;
    }

    // RESOLVE OCPP ID from ChargePoint UUID
    let targetOcppId = command.chargePointId;
    if (command.chargePointId) {
      // Assuming chargePointId is a UUID, we need the OCPP Identity
      const cp = await this.prisma.chargePoint.findUnique({ where: { id: command.chargePointId } });
      if (cp) {
        targetOcppId = cp.ocppId;
      } else {
        // Optimization: If not found by ID, maybe it IS the OCPP ID? (Legacy support)
        // But for now, we assume if it fails lookup, we might fail or try sending anyway.
        // Let's log a warning but try sending as-is in case it was already an OCPP ID.
      }
    }

    const request = {
      commandId: command.id,
      commandType: command.commandType,
      stationId: command.stationId || undefined,
      chargePointId: targetOcppId || undefined, // Send the resolved OCPP ID
      connectorId: undefined,
      payload: (command.payload as any) || {},
      requestedAt: command.requestedAt.toISOString(),
    };

    try {
      // Assuming commandRequests topic exists
      await this.kafka.publish(
        'ocpp.commands', // Hardcoded topic based on plan
        JSON.stringify(request),
        targetOcppId! // Use resolved ID as Key
      );

      const now = new Date();
      await this.prisma.commandOutbox.update({
        where: { id: outbox.id },
        data: {
          status: 'Published',
          publishedAt: now,
          updatedAt: now,
          lastError: null,
        }
      });
      await this.prisma.command.update({
        where: { id: command.id },
        data: {
          status: 'Sent',
          sentAt: now,
          error: null,
        }
      });
      await this.prisma.commandEvent.create({
        data: {
          commandId: command.id,
          status: 'Sent',
          payload: { commandType: command.commandType },
          occurredAt: now,
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Publish failed';
      await this.failOutbox(outbox, message);
    }
  }

  private async failOutbox(outbox: CommandOutbox, message: string): Promise<void> {
    const now = new Date();
    await this.prisma.commandOutbox.update({
      where: { id: outbox.id },
      data: {
        status: 'Failed',
        updatedAt: now,
        lastError: message,
      }
    });
    await this.prisma.command.update({
      where: { id: outbox.commandId },
      data: {
        status: 'Failed',
        error: message,
      }
    });
    await this.prisma.commandEvent.create({
      data: {
        commandId: outbox.commandId,
        status: 'Failed',
        payload: { error: message },
        occurredAt: now,
      }
    });
  }
}

import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma.service';
import { CommandRequest, CommandResponse } from '../../contracts/commands';

type CommandRecord = {
  id: string;
  stationId: string | null;
  chargePointId: string | null;
  connectorId: string | null;
  commandType: string;
  status: string;
  requestedAt: Date;
  sentAt: Date | null;
  completedAt: Date | null;
  error: string | null;
};

@Injectable()
export class CommandsService {
  constructor(private readonly prisma: PrismaService) {}

  async enqueueCommand(
    input: Omit<CommandRequest, 'commandId' | 'requestedAt'>,
  ): Promise<CommandResponse> {
    const now = new Date();
    const commandId = randomUUID();

    await this.prisma.command.create({
      data: {
        id: commandId,
        stationId: input.stationId || null,
        chargePointId: input.chargePointId || null,
        connectorId:
          input.connectorId !== undefined && input.connectorId !== null
            ? String(input.connectorId)
            : null,
        commandType: input.commandType,
        payload: (input.payload || {}) as any,
        status: 'Queued',
        requestedBy: input.requestedBy?.userId || null,
        requestedAt: now,
        sentAt: null,
        completedAt: null,
        correlationId: commandId,
        error: null,
      },
    });

    await this.prisma.commandOutbox.create({
      data: {
        commandId,
        status: 'Queued',
        attempts: 0,
        lockedAt: null,
        publishedAt: null,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      },
    });

    await this.prisma.commandEvent.create({
      data: {
        commandId,
        status: 'Queued',
        payload: { commandType: input.commandType },
        occurredAt: now,
      },
    });

    return {
      commandId,
      status: 'Queued',
      requestedAt: now.toISOString(),
    };
  }

  async enqueueReset(chargePointId: string): Promise<CommandResponse> {
    return this.enqueueCommand({
      commandType: 'Reset',
      chargePointId,
      requestedBy: {},
      payload: {},
    });
  }

  async enqueueRemoteStop(
    sessionId: string,
    reason?: string,
  ): Promise<CommandResponse> {
    return this.enqueueCommand({
      commandType: 'RemoteStop',
      requestedBy: {},
      payload: {
        sessionId,
        reason,
      },
    });
  }

  async getCommandById(commandId: string) {
    const command = await this.prisma.command.findUnique({
      where: { id: commandId },
      select: {
        id: true,
        stationId: true,
        chargePointId: true,
        connectorId: true,
        commandType: true,
        status: true,
        requestedAt: true,
        sentAt: true,
        completedAt: true,
        error: true,
      },
    });
    if (!command) return null;
    return this.toLifecycleRecord(command);
  }

  async listCommands(filter: {
    chargePointId: string;
    stationId?: string;
    limit?: number;
  }) {
    const normalizedLimit = Math.floor(filter.limit || 25);
    const limit = Math.min(Math.max(normalizedLimit, 1), 200);
    const where: {
      chargePointId: string;
      stationId?: string;
    } = {
      chargePointId: filter.chargePointId,
    };
    if (filter.stationId) {
      where.stationId = filter.stationId;
    }

    const commands = await this.prisma.command.findMany({
      where,
      orderBy: { requestedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        stationId: true,
        chargePointId: true,
        connectorId: true,
        commandType: true,
        status: true,
        requestedAt: true,
        sentAt: true,
        completedAt: true,
        error: true,
      },
    });
    return commands.map((command) => this.toLifecycleRecord(command));
  }

  private toLifecycleRecord(command: CommandRecord) {
    return {
      id: command.id,
      stationId: command.stationId,
      chargePointId: command.chargePointId,
      connectorId: command.connectorId,
      commandType: command.commandType,
      status: command.status,
      requestedAt: command.requestedAt.toISOString(),
      sentAt: command.sentAt ? command.sentAt.toISOString() : null,
      completedAt: command.completedAt ? command.completedAt.toISOString() : null,
      error: command.error,
    };
  }
}

import { Injectable } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { PrismaService } from '../../prisma.service'
import { CommandRequest, CommandResponse } from '../../contracts/commands'

@Injectable()
export class CommandsService {
  constructor(private readonly prisma: PrismaService) { }

  async enqueueCommand(input: Omit<CommandRequest, 'commandId' | 'requestedAt'>): Promise<CommandResponse> {
    const now = new Date()
    const commandId = randomUUID()

    const command = await this.prisma.command.create({
      data: {
        id: commandId,
        stationId: input.stationId || null,
        chargePointId: input.chargePointId || null,
        connectorId: typeof input.connectorId === 'string' ? input.connectorId : null,
        commandType: input.commandType,
        payload: (input.payload || {}) as any,
        status: 'Queued',
        requestedBy: input.requestedBy?.userId || null,
        requestedAt: now,
        sentAt: null,
        completedAt: null,
        correlationId: null,
        error: null,
      }
    })

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
      }
    })

    await this.prisma.commandEvent.create({
      data: {
        commandId,
        status: 'Queued',
        payload: { commandType: input.commandType },
        occurredAt: now,
      }
    })

    return {
      commandId,
      status: 'Queued',
      requestedAt: now.toISOString(),
    }
  }

  async enqueueReset(chargePointId: string): Promise<CommandResponse> {
    return this.enqueueCommand({
      commandType: 'Reset',
      chargePointId,
      requestedBy: {},
      payload: {},
    })
  }

  async enqueueRemoteStop(sessionId: string, reason?: string): Promise<CommandResponse> {
    return this.enqueueCommand({
      commandType: 'RemoteStop',
      requestedBy: {},
      payload: {
        sessionId,
        reason,
      },
    })
  }

  async getCommandById(commandId: string) {
    return this.prisma.command.findUnique({
      where: { id: commandId },
    })
  }
}

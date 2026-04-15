import { Injectable, Logger } from '@nestjs/common';
import { EventPattern, Payload, Ctx, MqttContext } from '@nestjs/microservices';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';

interface CommandResultPayload {
  tenantId: string;
  siteId: string;
  commandId: string;
  status: 'ACCEPTED' | 'REJECTED' | 'COMPLETED' | 'FAILED';
  result?: Record<string, unknown>;
  error?: string;
}

interface MqttCommandRequest {
  tenantId: string;
  siteId: string;
  chargerId: string;
  commandType: 'REMOTE_START' | 'REMOTE_STOP' | 'SET_AVAILABILITY' | 'RESET';
  payload?: Record<string, unknown>;
}

@Injectable()
export class CommandsMqttConsumer {
  private readonly logger = new Logger(CommandsMqttConsumer.name);

  constructor(private readonly prisma: PrismaService) {}

  @EventPattern('v1/+/+/+/commands/+/result')
  async handleCommandResult(
    @Payload() data: CommandResultPayload,
    @Ctx() context: MqttContext,
  ): Promise<void> {
    const topic = context.getTopic();
    const tenantId = this.extractTenantFromTopic(topic);

    if (!tenantId) {
      this.logger.warn(`Cannot extract tenant from topic: ${topic}`);
      return;
    }

    this.logger.debug(
      `Processing command result: ${data.commandId} - ${data.status}`,
    );

    const command = await this.prisma.command.findFirst({
      where: { correlationId: data.commandId },
    });

    if (!command) {
      this.logger.warn(`Command not found: ${data.commandId}`);
      return;
    }

    const updateData: Prisma.CommandUpdateInput = {
      status:
        data.status === 'COMPLETED'
          ? 'COMPLETED'
          : data.status === 'FAILED'
            ? 'FAILED'
            : 'COMPLETED',
    };

    if (data.status === 'COMPLETED' || data.status === 'FAILED') {
      updateData.completedAt = new Date();
    }

    if (data.error) {
      updateData.error = data.error;
    }

    await this.prisma.command.update({
      where: { id: command.id },
      data: updateData,
    });

    await this.prisma.commandEvent.create({
      data: {
        commandId: command.id,
        status: data.status,
        payload: data.result
          ? (data.result as Prisma.InputJsonValue)
          : undefined,
        occurredAt: new Date(),
      },
    });
  }

  async publishCommand(
    tenantId: string,
    siteId: string,
    chargerId: string,
    commandType: string,
    payload?: Record<string, unknown>,
    correlationId?: string,
  ): Promise<string> {
    const commandId = correlationId || `mqtt-cmd-${Date.now()}`;

    await this.prisma.command.create({
      data: {
        id: commandId,
        tenantId,
        stationId: null,
        chargePointId: chargerId,
        commandType,
        payload: payload as Prisma.InputJsonValue | undefined,
        status: 'PENDING',
        requestedAt: new Date(),
        correlationId,
      },
    });

    this.logger.debug(
      `Published command ${commandId} to MQTT for charger ${chargerId}`,
    );

    return commandId;
  }

  private extractTenantFromTopic(topic: string): string | null {
    const parts = topic.split('/');
    if (parts.length >= 2 && parts[0] === 'v1') {
      return parts[1];
    }
    return null;
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { EventPattern, Payload, Ctx, MqttContext } from '@nestjs/microservices';
import { PrismaService } from '../../prisma.service';

interface SessionCompletedPayload {
  tenantId: string;
  siteId: string;
  stationId: string;
  sessionId: string;
  transactionId?: string;
  userId?: string;
  rfidTag?: string;
  startTime: string;
  endTime: string;
  energyDelivered: number;
  amount?: number;
  currency?: string;
}

interface MeterReadingPayload {
  tenantId: string;
  siteId: string;
  meterId: string;
  energyExported: number;
  energyImported: number;
  voltage: number;
  current: number;
  power: number;
  frequency: number;
}

@Injectable()
export class BillingMqttConsumer {
  private readonly logger = new Logger(BillingMqttConsumer.name);

  constructor(private readonly prisma: PrismaService) {}

  @EventPattern('v1/+/+/+/session/+/completed')
  async handleSessionCompleted(
    @Payload() data: SessionCompletedPayload,
    @Ctx() context: MqttContext,
  ): Promise<void> {
    const topic = context.getTopic();
    const tenantId = this.extractTenantFromTopic(topic);

    if (!tenantId) {
      this.logger.warn(`Cannot extract tenant from topic: ${topic}`);
      return;
    }

    this.logger.debug(`Processing completed session: ${data.sessionId}`);

    const existingSession = await this.prisma.session.findUnique({
      where: { id: data.sessionId },
    });

    if (!existingSession) {
      this.logger.warn(`Session not found: ${data.sessionId}`);
      return;
    }

    if (existingSession.status === 'STOPPED') {
      this.logger.debug(`Session already completed: ${data.sessionId}`);
      return;
    }

    const endTime = data.endTime ? new Date(data.endTime) : new Date();
    const startTime = data.startTime
      ? new Date(data.startTime)
      : existingSession.startTime;
    const durationMs = endTime.getTime() - startTime.getTime();
    const durationMinutes = Math.round(durationMs / 60000);

    await this.prisma.session.update({
      where: { id: data.sessionId },
      data: {
        status: 'STOPPED',
        endTime,
        meterStop: data.energyDelivered,
        totalEnergy: data.energyDelivered,
        amount: data.amount ?? 0,
      },
    });

    this.logger.log(`Session ${data.sessionId} completed, ready for billing`);
  }

  @EventPattern('v1/+/+/+/meter/+/reading')
  async handleMeterReading(
    @Payload() data: MeterReadingPayload,
    @Ctx() context: MqttContext,
  ): Promise<void> {
    const topic = context.getTopic();
    const tenantId = this.extractTenantFromTopic(topic);

    if (!tenantId) {
      return;
    }

    this.logger.debug(`Processing meter reading from ${data.meterId}`);
  }

  @EventPattern('v1/+/+/+/battery-swap/+/session/+/completed')
  async handleBatterySwapCompleted(
    @Payload() data: SessionCompletedPayload,
    @Ctx() context: MqttContext,
  ): Promise<void> {
    const topic = context.getTopic();
    const tenantId = this.extractTenantFromTopic(topic);

    if (!tenantId) {
      return;
    }

    this.logger.debug(`Processing battery swap completed: ${data.sessionId}`);

    const station = await this.prisma.station.findFirst({
      where: { id: data.stationId },
    });

    if (!station) {
      this.logger.warn(`Station not found: ${data.stationId}`);
      return;
    }

    const endTime = data.endTime ? new Date(data.endTime) : new Date();
    const startTime = data.startTime
      ? new Date(data.startTime)
      : new Date(Date.now() - 300000);

    await this.prisma.session.create({
      data: {
        stationId: data.stationId,
        ocppId: data.stationId,
        ocppTxId: data.sessionId,
        connectorId: 1,
        userId: data.userId,
        startTime,
        endTime,
        status: 'STOPPED',
        meterStart: 0,
        meterStop: 0,
        totalEnergy: 0,
        amount: data.amount ?? 0,
      },
    });

    this.logger.log(
      `Battery swap ${data.sessionId} completed, ready for billing`,
    );
  }

  private extractTenantFromTopic(topic: string): string | null {
    const parts = topic.split('/');
    if (parts.length >= 2 && parts[0] === 'v1') {
      return parts[1];
    }
    return null;
  }
}

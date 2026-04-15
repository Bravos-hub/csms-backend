import { Injectable, Logger } from '@nestjs/common';
import { EventPattern, Payload, Ctx, MqttContext } from '@nestjs/microservices';
import { PrismaService } from '../../prisma.service';

interface ChargerTransactionPayload {
  tenantId: string;
  siteId: string;
  chargerId: string;
  transactionId: string;
  userId?: string;
  rfidTag?: string;
  startTime: string;
  endTime?: string;
  energyDelivered: number;
  status: 'STARTED' | 'COMPLETED' | 'STOPPED' | 'ERROR';
}

interface BatterySwapSessionPayload {
  tenantId: string;
  siteId: string;
  stationId: string;
  swapSessionId: string;
  vehicleId?: string;
  inboundPackSerialNumber: string;
  outboundPackSerialNumber: string;
  stage: string;
  duration?: number;
  error?: string;
}

interface LegacyEvseTransactionPayload {
  tenantId: string;
  siteId: string;
  chargerId: string;
  transactionId: string;
  userId?: string;
  rfidTag?: string;
  startTime: string;
  endTime?: string;
  energyDelivered: number;
  status: 'STARTED' | 'COMPLETED' | 'STOPPED' | 'ERROR';
}

@Injectable()
export class SessionMqttConsumer {
  private readonly logger = new Logger(SessionMqttConsumer.name);

  constructor(private readonly prisma: PrismaService) {}

  @EventPattern('v1/+/+/+/charger/+/transaction/started')
  async handleChargerTransactionStarted(
    @Payload() data: ChargerTransactionPayload,
    @Ctx() context: MqttContext,
  ): Promise<void> {
    const topic = context.getTopic();
    const tenantId = this.extractTenantFromTopic(topic);

    if (!tenantId) {
      this.logger.warn(`Cannot extract tenant from topic: ${topic}`);
      return;
    }

    this.logger.debug(`Handling charger transaction started: ${data.transactionId}`);

    const chargePoint = await this.prisma.chargePoint.findFirst({
      where: { ocppId: data.chargerId },
      include: { station: true },
    });

    if (!chargePoint) {
      this.logger.warn(`Unknown charger: ${data.chargerId}`);
      return;
    }

    const station = await this.prisma.station.findUnique({
      where: { id: chargePoint.stationId },
      include: { site: { include: { tenants: true } } },
    });

    if (!station?.site?.tenants?.some((t: { id: string }) => t.id === tenantId)) {
      this.logger.warn(`Charger ${data.chargerId} does not belong to tenant ${tenantId}`);
      return;
    }

    const existingSession = await this.prisma.session.findFirst({
      where: { ocppTxId: data.transactionId },
    });

    if (existingSession) {
      this.logger.debug(`Session already exists for transaction: ${data.transactionId}`);
      return;
    }

    try {
      await this.prisma.session.create({
        data: {
          stationId: chargePoint.stationId,
          ocppId: chargePoint.ocppId,
          ocppTxId: data.transactionId,
          connectorId: 1,
          idTag: data.rfidTag,
          userId: data.userId,
          startTime: new Date(data.startTime),
          status: 'ACTIVE',
          meterStart: 0,
        },
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('Unique constraint')) {
        this.logger.debug(`Session already exists (race condition) for transaction: ${data.transactionId}`);
        return;
      }
      throw error;
    }
  }

  @EventPattern('v1/+/+/+/charger/+/transaction/updated')
  async handleChargerTransactionUpdated(
    @Payload() data: ChargerTransactionPayload,
    @Ctx() context: MqttContext,
  ): Promise<void> {
    const topic = context.getTopic();
    const tenantId = this.extractTenantFromTopic(topic);

    if (!tenantId) {
      return;
    }

    this.logger.debug(`Handling charger transaction updated: ${data.transactionId}`);

    const session = await this.prisma.session.findFirst({
      where: { ocppTxId: data.transactionId },
      include: { chargePoint: { include: { station: { include: { site: { include: { tenants: true } } } } } } } } },
    });

    if (!session) {
      this.logger.warn(`Session not found for transaction: ${data.transactionId}`);
      return;
    }

    const sessionTenantIds = session.chargePoint?.station?.site?.tenants?.map((t: { id: string }) => t.id) || [];
    if (!sessionTenantIds.includes(tenantId)) {
      this.logger.warn(`Session ${session.id} does not belong to tenant ${tenantId}`);
      return;
    }

    if (data.status === 'COMPLETED' || data.status === 'STOPPED') {
      await this.prisma.session.update({
        where: { id: session.id },
        data: {
          status: 'STOPPED',
          endTime: data.endTime ? new Date(data.endTime) : new Date(),
          meterStop: data.energyDelivered,
          totalEnergy: data.energyDelivered,
        },
      });
    }
  }

  @EventPattern('v1/+/+/+/battery-swap/+/session/+/completed')
  async handleBatterySwapCompleted(
    @Payload() data: BatterySwapSessionPayload,
    @Ctx() context: MqttContext,
  ): Promise<void> {
    const topic = context.getTopic();
    const tenantId = this.extractTenantFromTopic(topic);

    if (!tenantId) {
      return;
    }

    this.logger.debug(`Handling battery swap completed: ${data.swapSessionId}`);

    const station = await this.prisma.station.findUnique({
      where: { id: data.stationId },
      include: { site: { include: { tenants: true } } },
    });

    if (!station) {
      this.logger.warn(`Station not found: ${data.stationId}`);
      return;
    }

    if (!station.site?.tenants?.some((t: { id: string }) => t.id === tenantId)) {
      this.logger.warn(`Station ${data.stationId} does not belong to tenant ${tenantId}`);
      return;
    }

    const existingSession = await this.prisma.session.findFirst({
      where: { ocppTxId: data.swapSessionId },
    });

    if (existingSession) {
      this.logger.debug(`Battery swap session already exists: ${data.swapSessionId}`);
      return;
    }

    const endTime = new Date();
    const startTime = data.duration
      ? new Date(endTime.getTime() - data.duration * 1000)
      : endTime;

    try {
      await this.prisma.session.create({
        data: {
          stationId: data.stationId,
          ocppId: data.stationId,
          ocppTxId: data.swapSessionId,
          connectorId: 1,
          userId: data.vehicleId,
          startTime,
          endTime,
          status: 'STOPPED',
          meterStart: 0,
          totalEnergy: 0,
        },
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('Unique constraint')) {
        this.logger.debug(`Battery swap session already exists (race condition): ${data.swapSessionId}`);
        return;
      }
      throw error;
    }
  }

  @EventPattern('v1/+/+/+/legacy-evse/+/transaction/+')
  async handleLegacyEvseTransaction(
    @Payload() data: LegacyEvseTransactionPayload,
    @Ctx() context: MqttContext,
  ): Promise<void> {
    const topic = context.getTopic();
    const tenantId = this.extractTenantFromTopic(topic);

    if (!tenantId) {
      return;
    }

    this.logger.debug(`Handling legacy EVSE transaction: ${data.transactionId}`);

    const chargePoint = await this.prisma.chargePoint.findFirst({
      where: { ocppId: data.chargerId },
      include: { station: true },
    });

    if (!chargePoint) {
      this.logger.warn(`Unknown legacy charger: ${data.chargerId}`);
      return;
    }

    const station = await this.prisma.station.findUnique({
      where: { id: chargePoint.stationId },
      include: { site: { include: { tenants: true } } },
    });

    if (!station?.site?.tenants?.some((t: { id: string }) => t.id === tenantId)) {
      this.logger.warn(`Legacy charger ${data.chargerId} does not belong to tenant ${tenantId}`);
      return;
    }

    if (data.status === 'STARTED') {
      const existingSession = await this.prisma.session.findFirst({
        where: { ocppTxId: data.transactionId },
      });

      if (existingSession) {
        this.logger.debug(`Legacy EVSE session already exists: ${data.transactionId}`);
        return;
      }

      try {
        await this.prisma.session.create({
          data: {
            stationId: chargePoint.stationId,
            ocppId: chargePoint.ocppId,
            ocppTxId: data.transactionId,
            connectorId: 1,
            idTag: data.rfidTag,
            userId: data.userId,
            startTime: new Date(data.startTime),
            status: 'ACTIVE',
            meterStart: 0,
          },
        });
      } catch (error) {
        if (error instanceof Error && error.message.includes('Unique constraint')) {
          this.logger.debug(`Legacy EVSE session already exists (race condition): ${data.transactionId}`);
          return;
        }
        throw error;
      }
    } else if (data.status === 'COMPLETED' || data.status === 'STOPPED') {
      const session = await this.prisma.session.findFirst({
        where: { ocppTxId: data.transactionId },
        include: { chargePoint: { include: { station: { include: { site: { include: { tenants: true } } } } } } } } },
      });

      if (session) {
        const sessionTenantIds = session.chargePoint?.station?.site?.tenants?.map((t: { id: string }) => t.id) || [];
        if (!sessionTenantIds.includes(tenantId)) {
          this.logger.warn(`Session ${session.id} does not belong to tenant ${tenantId}`);
          return;
        }
        await this.prisma.session.update({
          where: { id: session.id },
          data: {
            status: 'STOPPED',
            endTime: data.endTime ? new Date(data.endTime) : new Date(),
            meterStop: data.energyDelivered,
            totalEnergy: data.energyDelivered,
          },
        });
      }
    }
  }

  private extractTenantFromTopic(topic: string): string | null {
    const parts = topic.split('/');
    if (parts.length >= 2 && parts[0] === 'v1') {
      return parts[1];
    }
    return null;
  }
}
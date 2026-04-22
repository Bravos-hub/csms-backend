import { Injectable, Logger } from '@nestjs/common';
import { EventPattern, Payload, Ctx, MqttContext } from '@nestjs/microservices';
import { PrismaService } from '../../prisma.service';
import { MqttEventPublisherService } from '@app/mqtt';

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

interface BmsSocPayload {
  tenantId: string;
  siteId: string;
  stationId: string;
  packSerialNumber: string;
  soc: number;
  soh?: number;
  voltage?: number;
  current?: number;
}

interface PvOutputPayload {
  tenantId: string;
  siteId: string;
  pvSystemId: string;
  powerOutput: number;
  irradiance?: number;
}

interface SmartChargingCommandPayload {
  tenantId: string;
  siteId: string;
  chargerId: string;
  commandType:
    | 'SET_POWER_LIMIT'
    | 'REMOTE_START'
    | 'REMOTE_STOP'
    | 'SET_AVAILABILITY';
  payload: Record<string, unknown>;
  timestamp: string;
}

@Injectable()
export class EnergyManagementMqttConsumer {
  private readonly logger = new Logger(EnergyManagementMqttConsumer.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventPublisher: MqttEventPublisherService,
  ) {}

  @EventPattern('v1/+/+/+/site/+/meter/+/power')
  async handleMeterReading(
    @Payload() data: MeterReadingPayload,
    @Ctx() context: MqttContext,
  ): Promise<void> {
    const topic = context.getTopic();
    const tenantId = this.extractTenantFromTopic(topic);

    if (!tenantId) {
      this.logger.warn(`Cannot extract tenant from topic: ${topic}`);
      return;
    }

    this.logger.debug(`Processing meter reading from ${data.meterId}`);

    const station = await this.prisma.station.findFirst({
      where: { siteId: data.siteId },
      orderBy: { createdAt: 'asc' },
    });

    if (!station) {
      this.logger.warn(`No station found for site: ${data.siteId}`);
      return;
    }

    const groups = await this.prisma.energyLoadGroup.findMany({
      where: {
        tenantId,
        stationId: station.id,
        isActive: true,
      },
    });

    const snapshotOps = groups.map((group) =>
      this.prisma.energyTelemetrySnapshot.create({
        data: {
          groupId: group.id,
          stationId: station.id,
          sampledAt: new Date(),
          meterSource: data.meterId,
          meterPlacement: 'MAIN',
          siteLoadAmpsPhase1: Math.round(data.current / 3),
          siteLoadAmpsPhase2: Math.round(data.current / 3),
          siteLoadAmpsPhase3: Math.round(data.current / 3),
          nonEvLoadAmpsPhase1: 0,
          nonEvLoadAmpsPhase2: 0,
          nonEvLoadAmpsPhase3: 0,
          freshnessSec: 0,
        },
      }),
    );

    const groupUpdateOps = groups.map((group) =>
      this.prisma.energyLoadGroup.update({
        where: { id: group.id },
        data: { latestTelemetryAt: new Date() },
      }),
    );

    try {
      await this.prisma.$transaction([...snapshotOps, ...groupUpdateOps]);
    } catch (error) {
      this.logger.error(
        `Failed to process meter reading for ${data.meterId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  @EventPattern('v1/+/+/+/bms/+/soc')
  async handleBmsSoc(
    @Payload() data: BmsSocPayload,
    @Ctx() context: MqttContext,
  ): Promise<void> {
    const topic = context.getTopic();
    const tenantId = this.extractTenantFromTopic(topic);

    if (!tenantId) {
      return;
    }

    this.logger.debug(`Processing BMS SoC for pack ${data.packSerialNumber}`);

    const pack = await this.prisma.batteryPack.findUnique({
      where: { serialNumber: data.packSerialNumber },
    });

    if (!pack) {
      this.logger.warn(`Unknown battery pack: ${data.packSerialNumber}`);
      return;
    }

    if (typeof data.soc !== 'number' || data.soc < 0 || data.soc > 100) {
      this.logger.warn(
        `Invalid SoC value ${data.soc} for pack ${data.packSerialNumber}, expected 0-100`,
      );
      return;
    }

    await this.prisma.batteryPack.update({
      where: { id: pack.id },
      data: {
        soc: data.soc,
        soh: data.soh ?? pack.soh,
        voltage: data.voltage ?? pack.voltage,
        current: data.current ?? pack.current,
      },
    });
  }

  @EventPattern('v1/+/+/+/pv/+/output')
  async handlePvOutput(
    @Payload() data: PvOutputPayload,
    @Ctx() context: MqttContext,
  ): Promise<void> {
    const topic = context.getTopic();
    const tenantId = this.extractTenantFromTopic(topic);

    if (!tenantId) {
      return;
    }

    this.logger.debug(`Processing PV output from ${data.pvSystemId}`);

    const station = await this.prisma.station.findFirst({
      where: { siteId: data.siteId },
      orderBy: { createdAt: 'asc' },
    });

    if (!station) {
      return;
    }

    const profile = await this.prisma.energyDerProfile.findUnique({
      where: {
        tenantId_stationId: {
          tenantId,
          stationId: station.id,
        },
      },
    });

    if (!profile?.solarEnabled) {
      return;
    }

    const groups = await this.prisma.energyLoadGroup.findMany({
      where: {
        tenantId,
        stationId: station.id,
        isActive: true,
      },
    });

    const maxSolar = profile.maxSolarContributionKw || 0;
    const availablePower = Math.min(data.powerOutput, maxSolar);

    const snapshotOps = groups.map((group) =>
      this.prisma.energyTelemetrySnapshot.create({
        data: {
          groupId: group.id,
          stationId: station.id,
          sampledAt: new Date(),
          meterSource: `pv-${data.pvSystemId}`,
          meterPlacement: 'DERIVED',
          availableAmpsPhase1: Math.round((availablePower * 1000) / 3 / 230),
          availableAmpsPhase2: Math.round((availablePower * 1000) / 3 / 230),
          availableAmpsPhase3: Math.round((availablePower * 1000) / 3 / 230),
          freshnessSec: 0,
        },
      }),
    );

    try {
      await this.prisma.$transaction(snapshotOps);
    } catch (error) {
      this.logger.error(
        `Failed to process PV output for ${data.pvSystemId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  @EventPattern('v1/+/+/+/smart-charging/+/command')
  async handleSmartChargingCommand(
    @Payload() data: SmartChargingCommandPayload,
    @Ctx() context: MqttContext,
  ): Promise<void> {
    const topic = context.getTopic();
    const tenantId = this.extractTenantFromTopic(topic);

    if (!tenantId) {
      return;
    }

    this.logger.debug(`Received smart charging command for ${data.chargerId}`);

    if (data.commandType === 'SET_POWER_LIMIT') {
      const rawValue = data.payload.maxPowerWatts;
      const limitWatts =
        typeof rawValue === 'number' && Number.isFinite(rawValue)
          ? rawValue
          : typeof rawValue === 'string'
            ? Number(rawValue)
            : undefined;

      if (!Number.isFinite(limitWatts)) {
        const rawValueForLog =
          typeof rawValue === 'string' || typeof rawValue === 'number'
            ? String(rawValue)
            : JSON.stringify(rawValue);
        this.logger.warn(
          `Invalid maxPowerWatts in SET_POWER_LIMIT command: ${rawValueForLog}`,
        );
        return;
      }

      const limitAmps = Math.round((limitWatts as number) / 230);

      const chargePoint = await this.prisma.chargePoint.findFirst({
        where: { ocppId: data.chargerId },
      });

      if (!chargePoint) {
        this.logger.warn(`Unknown charger: ${data.chargerId}`);
        return;
      }

      const station = await this.prisma.station.findUnique({
        where: { id: chargePoint.stationId },
      });

      if (!station) {
        return;
      }

      const groups = await this.prisma.energyLoadGroup.findMany({
        where: {
          tenantId,
          stationId: station.id,
          controlMode: 'ACTIVE',
        },
        include: {
          memberships: {
            where: { chargePointId: chargePoint.id, enabled: true },
          },
        },
      });

      for (const group of groups) {
        if (group.memberships.length > 0) {
          await this.prisma.energyLoadGroupMembership.update({
            where: { id: group.memberships[0].id },
            data: {
              lastAppliedAmps: limitAmps,
              lastCommandAt: new Date(),
              lastCommandStatus: 'APPLIED',
            },
          });
        }
      }
    }
  }

  @EventPattern('v1/+/+/+/smart-charging/+/command/result')
  handleSmartChargingResult(
    @Payload() payload: { commandId: string; status: string; error?: string },
    @Ctx() context: MqttContext,
  ): void {
    const topic = context.getTopic();
    const tenantId = this.extractTenantFromTopic(topic);

    if (!tenantId) {
      return;
    }

    this.logger.debug(
      `Smart charging command result: ${payload.commandId} - ${payload.status}`,
    );
  }

  sendSmartChargingCommand(
    tenantId: string,
    siteId: string,
    chargerId: string,
    commandType: 'SET_POWER_LIMIT',
    payload: Record<string, unknown>,
  ): Promise<void> {
    const timestamp = new Date();
    const event = {
      tenantId,
      siteId,
      chargerId,
      commandType,
      payload,
      timestamp,
    };

    this.eventPublisher.publishSmartChargingCommand(event, tenantId);
    return Promise.resolve();
  }

  private extractTenantFromTopic(topic: string): string | null {
    const parts = topic.split('/');
    if (parts.length >= 2 && parts[0] === 'v1') {
      return parts[1];
    }
    return null;
  }
}

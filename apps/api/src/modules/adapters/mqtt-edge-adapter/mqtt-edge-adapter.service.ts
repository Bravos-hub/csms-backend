import { Injectable, Logger } from '@nestjs/common';
import { EventPattern, Payload, Ctx, MqttContext } from '@nestjs/microservices';
import { PrismaService } from '../../../prisma.service';
import { MqttEventPublisherService } from '@app/mqtt';

interface VendorTelemetryPayload {
  vendorDeviceId: string;
  vendorType: string;
  timestamp: string;
  data: Record<string, unknown>;
}

interface BmsPayload {
  bmsSerial: string;
  soc?: number;
  soh?: number;
  voltage?: number;
  current?: number;
  temperature?: number;
  alertCodes?: string[];
}

interface MeterPayload {
  meterId: string;
  energyImported: number;
  energyExported: number;
  power: number;
  voltage: number;
  current: number;
  frequency: number;
  powerFactor?: number;
}

interface PvPayload {
  pvSystemId: string;
  powerOutput: number;
  irradiance?: number;
  temperature?: number;
}

interface BuildingControllerPayload {
  systemId: string;
  hvacStatus?: string;
  lightingStatus?: string;
  securityStatus?: string;
}

interface BessPayload {
  bessId: string;
  soc?: number;
  power: number;
  chargeState?: string;
}

@Injectable()
export class MqttEdgeAdapterService {
  private readonly logger = new Logger(MqttEdgeAdapterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventPublisher: MqttEventPublisherService,
  ) {}

  @EventPattern('evzone/edge/+/bms/+/telemetry')
  async handleBmsTelemetry(
    @Payload() data: BmsPayload,
    @Ctx() context: MqttContext,
  ): Promise<void> {
    const topic = context.getTopic();
    const topicParts = topic.split('/');
    const siteId = topicParts[2];
    const bmsSerial = data.bmsSerial || topicParts[4];

    this.logger.debug(`Processing BMS telemetry from ${bmsSerial}`);

    try {
      const registry = await this.prisma.mqttDeviceRegistry.findFirst({
        where: {
          vendorDeviceId: bmsSerial,
          integrationType: 'BMS',
          isActive: true,
        },
      });

      if (!registry) {
        this.logger.warn(`Unknown BMS device: ${bmsSerial}`);
        return;
      }

      const pack = await this.prisma.batteryPack.findUnique({
        where: { serialNumber: bmsSerial },
      });

      if (pack) {
        await this.prisma.batteryPack.update({
          where: { id: pack.id },
          data: {
            soc: data.soc ?? pack.soc,
            soh: data.soh ?? pack.soh,
            voltage: data.voltage ?? pack.voltage,
            current: data.current ?? pack.current,
          },
        });

        await this.prisma.batteryTelemetry.create({
          data: {
            packId: pack.id,
            voltage: data.voltage || 0,
            current: data.current || 0,
            soc: data.soc || 0,
            soh: data.soh || null,
            temps: data.temperature ? [data.temperature] : [],
            cells: [],
          },
        });

        const evt = {
          tenantId: registry.tenantId,
          siteId: registry.siteId,
          timestamp: new Date(),
          stationId: registry.stationId || '',
          packSerialNumber: bmsSerial,
          slotId: 'unknown',
          soc: data.soc || 0,
          health: data.soh || 100,
          voltage: data.voltage || 0,
          current: data.current || 0,
          cycles: 0,
          temperature: data.temperature || 0,
          status: 'AVAILABLE' as const,
        };
        await this.eventPublisher.publishBatteryPackState(evt, registry.tenantId);
      } else {
        this.logger.warn(
          `Battery pack not found for known registry: ${registry.id}, tenant: ${registry.tenantId}, site: ${registry.siteId}, bmsSerial: ${bmsSerial}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Error processing BMS telemetry for ${bmsSerial}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  @EventPattern('evzone/edge/+/meter/+/reading')
  async handleMeterReading(
    @Payload() data: MeterPayload,
    @Ctx() context: MqttContext,
  ): Promise<void> {
    const topic = context.getTopic();
    const topicParts = topic.split('/');
    const siteId = topicParts[2];
    const meterId = data.meterId || topicParts[4];

    this.logger.debug(`Processing meter reading from ${meterId}`);

    const registry = await this.prisma.mqttDeviceRegistry.findFirst({
      where: {
        vendorDeviceId: meterId,
        siteId,
        isActive: true,
      },
    });

    const tenantId = registry?.tenantId || 'default';

    const evt = {
      tenantId,
      siteId,
      timestamp: new Date(),
      meterId,
      energyExported: data.energyExported || 0,
      energyImported: data.energyImported || 0,
      voltage: data.voltage || 0,
      current: data.current || 0,
      power: data.power || 0,
      frequency: data.frequency || 0,
    };
    await this.eventPublisher.publishMeterReading(evt, tenantId);
  }

  @EventPattern('evzone/edge/+/pv/+/output')
  async handlePvOutput(
    @Payload() data: PvPayload,
    @Ctx() context: MqttContext,
  ): Promise<void> {
    const topic = context.getTopic();
    const topicParts = topic.split('/');
    const siteId = topicParts[2];
    const pvSystemId = data.pvSystemId || topicParts[4];

    this.logger.debug(`Processing PV output from ${pvSystemId}`);

    const registry = await this.prisma.mqttDeviceRegistry.findFirst({
      where: {
        vendorDeviceId: pvSystemId,
        siteId,
        isActive: true,
      },
    });

    const tenantId = registry?.tenantId || 'default';

    const evt = {
      tenantId,
      siteId,
      timestamp: new Date(),
      pvSystemId,
      powerOutput: data.powerOutput || 0,
      irradiance: data.irradiance,
    };

    await this.eventPublisher.publishPvOutput(evt, tenantId);
  }

  @EventPattern('evzone/edge/+/building/+/status')
  async handleBuildingControllerStatus(
    @Payload() data: BuildingControllerPayload,
    @Ctx() context: MqttContext,
  ): Promise<void> {
    const topic = context.getTopic();
    const topicParts = topic.split('/');
    const siteId = topicParts[2];
    const systemId = data.systemId || topicParts[4];

    this.logger.debug(`Processing building controller status from ${systemId}`);
  }

  @EventPattern('evzone/edge/+/bess/+/status')
  async handleBessStatus(
    @Payload() data: BessPayload,
    @Ctx() context: MqttContext,
  ): Promise<void> {
    const topic = context.getTopic();
    const topicParts = topic.split('/');
    const siteId = topicParts[2];
    const bessId = data.bessId || topicParts[4];

    this.logger.debug(`Processing BESS status from ${bessId}`);

    const station = await this.prisma.station.findFirst({
      where: { siteId },
      orderBy: { createdAt: 'asc' },
    });

    if (!station) {
      this.logger.warn(`No station found for siteId: ${siteId}`);
      return;
    }

    const profile = await this.prisma.energyDerProfile.findFirst({
      where: { stationId: station.id, bessEnabled: true },
      orderBy: { createdAt: 'asc' },
    });

    if (profile) {
      await this.prisma.energyDerProfile.update({
        where: { id: profile.id },
        data: {
          bessSocPercent: data.soc ?? profile.bessSocPercent,
        },
      });
    }
  }
}

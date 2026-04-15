import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventPattern, Payload, Ctx, MqttContext } from '@nestjs/microservices';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';

interface BmsTelemetryPayload {
  packSerialNumber: string;
  voltage?: number;
  current?: number;
  soc?: number;
  soh?: number;
  temps?: number[];
  cellvolt?: number[];
  alerts?: Record<string, unknown>;
  cycles?: number;
  bmsType?: string;
  capacity?: number;
}

@Injectable()
export class BmsService {
  private readonly logger = new Logger(BmsService.name);

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {}

  @EventPattern('evzone/telemetry/packs/+')
  async handleIncomingTelemetry(
    @Payload() data: BmsTelemetryPayload,
    @Ctx() context: MqttContext,
  ): Promise<void> {
    const topic = context.getTopic();
    const topicParts = topic.split('/');
    const packSerialNumber =
      data?.packSerialNumber || topicParts[topicParts.length - 1];

    if (!packSerialNumber) {
      this.logger.warn(
        `Received telemetry with no pack serial number on topic ${topic}`,
      );
      return;
    }

    let pack = await this.prisma.batteryPack.findUnique({
      where: { serialNumber: packSerialNumber },
    });

    if (!pack) {
      this.logger.log(
        `Registering new BatteryPack via Edge Gateway detection: ${packSerialNumber}`,
      );
      pack = await this.prisma.batteryPack.create({
        data: {
          serialNumber: packSerialNumber,
          bmsType: this.readString(data.bmsType) || 'UNKNOWN_3RD_PARTY',
          status: 'READY',
          capacityAh: this.readNumber(data.capacity) || 0,
        },
      });
    }

    if (pack.status === 'FAULTED' || pack.status === 'RETIRED') {
      return;
    }

    await this.prisma.batteryTelemetry.create({
      data: {
        packId: pack.id,
        voltage: this.readNumber(data.voltage) || 0,
        current: this.readNumber(data.current) || 0,
        soc: this.readNumber(data.soc) || 0,
        soh: this.readNumber(data.soh) || null,
        temps: this.readNumberArray(data.temps),
        cells: this.readNumberArray(data.cellvolt),
        alerts: this.readRecord(data.alerts) || ({} as Prisma.JsonObject),
      },
    });

    const soc = this.readNumber(data.soc);
    const soh = this.readNumber(data.soh);
    const voltage = this.readNumber(data.voltage);
    const current = this.readNumber(data.current);
    const cycles = this.readNumber(data.cycles);

    await this.prisma.batteryPack.update({
      where: { id: pack.id },
      data: {
        soc: soc ?? pack.soc,
        soh: soh ?? pack.soh,
        voltage: voltage ?? pack.voltage,
        current: current ?? pack.current,
        cycleCount: cycles ?? pack.cycleCount,
      },
    });
  }

  @EventPattern('evzone/secure/commands/+/packs/+/kill')
  async handleRemoteKillCommand(
    @Payload()
    payload: { action: string; authorizedBy: string; timestamp: string },
    @Ctx() context: MqttContext,
  ): Promise<{ success: boolean; message: string }> {
    const topic = context.getTopic();
    const topicMatch = topic.match(
      /evzone\/secure\/commands\/([^/]+)\/packs\/([^/]+)\/kill/,
    );

    if (!topicMatch) {
      this.logger.warn(`Invalid kill command topic format: ${topic}`);
      return { success: false, message: 'Invalid topic format' };
    }

    const [, stationId, packSerial] = topicMatch;

    const timestampMs = Date.parse(payload.timestamp);
    if (isNaN(timestampMs)) {
      this.logger.warn(`Invalid timestamp in kill command: ${payload.timestamp}`);
      return { success: false, message: 'Invalid timestamp' };
    }

    const now = Date.now();
    const clockSkewMs = 5 * 60 * 1000;
    if (Math.abs(now - timestampMs) > clockSkewMs) {
      this.logger.warn(
        `Stale timestamp in kill command: ${payload.timestamp}, now: ${now}`,
      );
      return { success: false, message: 'Timestamp out of acceptable range' };
    }

    const allowedAdmins = this.configService.get<string>('ALLOWED_REMOTE_KILL_ADMINS')?.split(',') || [];
    if (allowedAdmins.length > 0 && !allowedAdmins.includes(payload.authorizedBy)) {
      this.logger.warn(
        `Unauthorized kill command attempt by ${payload.authorizedBy} for pack ${packSerial}`,
      );
      return { success: false, message: 'Unauthorized' };
    }

    const pack = await this.prisma.batteryPack.findUnique({
      where: { serialNumber: packSerial },
    });

    if (!pack) {
      this.logger.warn(`Kill command for unknown pack: ${packSerial}`);
      return { success: false, message: 'Pack not found' };
    }

    this.logger.warn(
      `Remote Kill Command received for Pack ${pack.serialNumber} at station ${stationId} by ${payload.authorizedBy}`,
    );

    await this.prisma.batteryPack.update({
      where: { id: pack.id },
      data: { status: 'LOCKED_REMOTE' },
    });

    return { success: true, message: 'Pack locked' };
  }

  async dispatchRemoteKill(
    packId: string,
    stationId: string,
    adminUserId: string,
  ): Promise<boolean> {
    const pack = await this.prisma.batteryPack.findUnique({
      where: { id: packId },
    });
    if (!pack) {
      throw new Error(`BatteryPack ${packId} not found`);
    }

    return true;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  private readRecord(value: unknown): Prisma.JsonObject | undefined {
    return this.isRecord(value) ? (value as Prisma.JsonObject) : undefined;
  }

  private readString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private readNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return undefined;
  }

  private readNumberArray(value: unknown): number[] {
    if (!Array.isArray(value)) {
      return [];
    }
    const numbers = value
      .map((item) => this.readNumber(item))
      .filter((item): item is number => item !== undefined);
    return numbers;
  }
}

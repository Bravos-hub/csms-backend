import { Injectable, Logger } from '@nestjs/common';
import {
  BatteryCabinetStatus,
  BatteryPackStatus,
  Prisma,
  SwapSessionStage,
} from '@prisma/client';
import { PrismaService } from '../../../prisma.service';
import {
  BatteryCabinetStatusEvent,
  BatteryPackStateEvent,
  BatterySwapSessionEvent,
} from '@app/mqtt';

@Injectable()
export class BatterySwapPersistenceService {
  private readonly logger = new Logger(BatterySwapPersistenceService.name);

  constructor(private readonly prisma: PrismaService) {}

  async persistCabinetStatus(
    tenantId: string,
    event: BatteryCabinetStatusEvent,
  ): Promise<void> {
    try {
      const cabinet = await this.prisma.batteryCabinet.upsert({
        where: { cabinetId: event.cabinetId },
        update: {
          status: event.isOnline
            ? BatteryCabinetStatus.ONLINE
            : BatteryCabinetStatus.OFFLINE,
          isOnline: event.isOnline,
          powerState: event.powerState,
          doorLocked: event.doorLocked,
          robotHealth: event.robotHealth,
          totalSlots: event.totalSlots,
          occupiedSlots: event.occupiedSlots,
          faultCodes: event.faultCodes,
          lastHeartbeatAt: new Date(),
        },
        create: {
          cabinetId: event.cabinetId,
          stationId: event.stationId,
          providerId: '', // Will be filled by assignment logic later if needed
          tenantId,
          status: event.isOnline
            ? BatteryCabinetStatus.ONLINE
            : BatteryCabinetStatus.OFFLINE,
          isOnline: event.isOnline,
          powerState: event.powerState,
          doorLocked: event.doorLocked,
          robotHealth: event.robotHealth,
          totalSlots: event.totalSlots,
          occupiedSlots: event.occupiedSlots,
          faultCodes: event.faultCodes,
          lastHeartbeatAt: new Date(),
        },
      });

      // Ensure slots exist
      const existingSlots = await this.prisma.batteryCabinetSlot.findMany({
        where: { cabinetId: cabinet.id },
      });

      const existingSlotNumbers = new Set(
        existingSlots.map((s) => s.slotNumber),
      );
      const slotsToCreate: Prisma.BatteryCabinetSlotCreateManyInput[] = [];

      for (let i = 1; i <= event.totalSlots; i++) {
        if (!existingSlotNumbers.has(i)) {
          slotsToCreate.push({
            cabinetId: cabinet.id,
            slotNumber: i,
            status: 'EMPTY',
          });
        }
      }

      if (slotsToCreate.length > 0) {
        await this.prisma.batteryCabinetSlot.createMany({
          data: slotsToCreate,
          skipDuplicates: true,
        });
      }
    } catch (error) {
      this.logger.error(
        `Failed to persist cabinet status: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async persistPackState(
    tenantId: string,
    event: BatteryPackStateEvent,
  ): Promise<void> {
    try {
      const pack = await this.prisma.batteryPack.upsert({
        where: { serialNumber: event.packSerialNumber },
        update: {
          soc: event.soc,
          soh: event.health,
          voltage: event.voltage,
          current: event.current,
          temperature: event.temperature,
          cycleCount: event.cycles,
          status: this.mapPackStatus(event.status),
          lastTelemetryAt: new Date(),
        },
        create: {
          serialNumber: event.packSerialNumber,
          status: this.mapPackStatus(event.status),
          bmsType: 'UNKNOWN_3RD_PARTY',
          soc: event.soc,
          soh: event.health,
          voltage: event.voltage,
          current: event.current,
          temperature: event.temperature,
          cycleCount: event.cycles,
          tenantId,
          lastTelemetryAt: new Date(),
        },
      });

      await this.prisma.batteryTelemetry.create({
        data: {
          packId: pack.id,
          source: 'MQTT_BMS',
          voltage: event.voltage,
          current: event.current,
          soc: event.soc,
          soh: event.health,
          temps: event.temperature ? [event.temperature] : [],
          cells: [],
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to persist pack state: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async persistSwapSession(
    tenantId: string,
    event: BatterySwapSessionEvent,
  ): Promise<void> {
    try {
      await this.prisma.swapSession.upsert({
        where: { sessionId: event.swapSessionId },
        update: {
          stage: event.stage as SwapSessionStage,
          durationSec: event.duration,
          failureReason: event.error || undefined,
          completedAt: event.stage === 'COMPLETE' ? new Date() : undefined,
        },
        create: {
          sessionId: event.swapSessionId,
          stationId: event.stationId,
          providerId: '', // Filled later via assignment
          tenantId,
          inboundPackId: event.inboundPackSerialNumber,
          outboundPackId: event.outboundPackSerialNumber,
          stage: event.stage as SwapSessionStage,
          durationSec: event.duration,
          failureReason: event.error || undefined,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to persist swap session: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private mapPackStatus(
    status: BatteryPackStateEvent['status'],
  ): BatteryPackStatus {
    switch (status) {
      case 'AVAILABLE':
        return BatteryPackStatus.READY;
      case 'IN_TRANSIT':
        return BatteryPackStatus.IN_TRANSIT;
      case 'SWAPPING':
        return BatteryPackStatus.IN_SWAP;
      case 'DEGRADED':
        return BatteryPackStatus.DEGRADED;
      default:
        return BatteryPackStatus.UNKNOWN;
    }
  }
}

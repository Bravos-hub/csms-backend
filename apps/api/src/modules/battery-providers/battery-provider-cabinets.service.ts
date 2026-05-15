import { Injectable, NotFoundException } from '@nestjs/common';
import { BatteryCabinetStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  BatteryProviderAccessService,
  ResolvedProviderScope,
} from './battery-provider-access.service';

@Injectable()
export class BatteryProviderCabinetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: BatteryProviderAccessService,
    private readonly audit: AuditLogsService,
  ) {}

  async listCabinets(
    scope: ResolvedProviderScope,
    filters: {
      stationId?: string;
      status?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const where = this.accessService.buildProviderCabinetWhere(scope);
    const conditions: Prisma.BatteryCabinetWhereInput[] = [where];

    if (filters.stationId) {
      conditions.push({ stationId: filters.stationId });
    }
    if (filters.status) {
      conditions.push({ status: filters.status as BatteryCabinetStatus });
    }

    const finalWhere: Prisma.BatteryCabinetWhereInput =
      conditions.length > 1 ? { AND: conditions } : conditions[0];

    const page = filters.page ?? 1;
    const limit = Math.min(filters.limit ?? 25, 100);
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.batteryCabinet.findMany({
        where: finalWhere,
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.batteryCabinet.count({ where: finalWhere }),
    ]);

    return { items, total, page, limit };
  }

  async getCabinetDetail(scope: ResolvedProviderScope, cabinetId: string) {
    const cabinet = await this.prisma.batteryCabinet.findFirst({
      where: this.accessService.buildProviderCabinetWhere(scope, { id: cabinetId }),
    });

    if (!cabinet) {
      throw new NotFoundException('Cabinet not found');
    }

    return cabinet;
  }

  async getCabinetSlots(scope: ResolvedProviderScope, cabinetId: string) {
    await this.getCabinetDetail(scope, cabinetId);

    return this.prisma.batteryCabinetSlot.findMany({
      where: { cabinetId },
      include: { pack: true },
      orderBy: { slotNumber: 'asc' },
    });
  }

  async getCabinetTelemetry(
    scope: ResolvedProviderScope,
    cabinetId: string,
    limit = 50,
  ) {
    await this.getCabinetDetail(scope, cabinetId);

    // Cabinet telemetry is stored in mqttVendorPayloadLog for now
    return this.prisma.mqttVendorPayloadLog.findMany({
      where: {
        normalizedEventType: 'CABINET_STATUS',
        payload: {
          path: ['cabinetId'],
          equals: cabinetId,
        },
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 100),
    });
  }

  async setMaintenanceMode(
    scope: ResolvedProviderScope,
    cabinetId: string,
    actorId: string,
  ) {
    const cabinet = await this.getCabinetDetail(scope, cabinetId);

    const updated = await this.prisma.batteryCabinet.update({
      where: { id: cabinetId },
      data: { status: BatteryCabinetStatus.MAINTENANCE },
    });

    await this.audit.log(
      actorId,
      'cabinet.maintenance',
      'BATTERY_CABINET',
      cabinetId,
      {
        providerId: scope.providerId,
        tenantId: scope.tenantId,
        beforeStatus: cabinet.status,
        afterStatus: updated.status,
      },
    );

    return updated;
  }

  async setSlotEnabled(
    scope: ResolvedProviderScope,
    cabinetId: string,
    slotId: string,
    enabled: boolean,
    actorId: string,
  ) {
    await this.getCabinetDetail(scope, cabinetId);

    const slot = await this.prisma.batteryCabinetSlot.findFirst({
      where: { id: slotId, cabinetId },
    });

    if (!slot) {
      throw new NotFoundException('Slot not found');
    }

    const updated = await this.prisma.batteryCabinetSlot.update({
      where: { id: slotId },
      data: { isEnabled: enabled },
    });

    await this.audit.log(
      actorId,
      enabled ? 'slot.enable' : 'slot.disable',
      'BATTERY_CABINET_SLOT',
      slotId,
      {
        providerId: scope.providerId,
        tenantId: scope.tenantId,
        cabinetId,
        beforeEnabled: slot.isEnabled,
        afterEnabled: updated.isEnabled,
      },
    );

    return updated;
  }
}

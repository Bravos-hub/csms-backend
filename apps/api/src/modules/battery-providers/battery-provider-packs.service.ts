import { Injectable, NotFoundException } from '@nestjs/common';
import { BatteryPackStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  BatteryProviderAccessService,
  ResolvedProviderScope,
} from './battery-provider-access.service';

@Injectable()
export class BatteryProviderPacksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: BatteryProviderAccessService,
    private readonly audit: AuditLogsService,
  ) {}

  async listPacks(
    scope: ResolvedProviderScope,
    filters: {
      stationId?: string;
      cabinetId?: string;
      status?: string;
      minSoc?: number;
      minSoh?: number;
      faulted?: boolean;
      page?: number;
      limit?: number;
    },
  ) {
    const where = this.accessService.buildProviderPackWhere(scope);
    const conditions: Prisma.BatteryPackWhereInput[] = [where];

    if (filters.stationId) {
      conditions.push({ stationId: filters.stationId });
    }
    if (filters.cabinetId) {
      conditions.push({ cabinetId: filters.cabinetId });
    }
    if (filters.status) {
      conditions.push({ status: filters.status as BatteryPackStatus });
    }
    if (filters.minSoc !== undefined) {
      conditions.push({ soc: { gte: filters.minSoc } });
    }
    if (filters.minSoh !== undefined) {
      conditions.push({ soh: { gte: filters.minSoh } });
    }
    if (filters.faulted) {
      conditions.push({ status: BatteryPackStatus.FAULTED });
    }

    const finalWhere: Prisma.BatteryPackWhereInput =
      conditions.length > 1 ? { AND: conditions } : conditions[0];

    const page = filters.page ?? 1;
    const limit = Math.min(filters.limit ?? 25, 100);
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.batteryPack.findMany({
        where: finalWhere,
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.batteryPack.count({ where: finalWhere }),
    ]);

    return { items, total, page, limit };
  }

  async getPackDetail(scope: ResolvedProviderScope, packId: string) {
    const pack = await this.prisma.batteryPack.findFirst({
      where: this.accessService.buildProviderPackWhere(scope, { id: packId }),
    });

    if (!pack) {
      throw new NotFoundException('Pack not found');
    }

    return pack;
  }

  async getPackTelemetry(
    scope: ResolvedProviderScope,
    packId: string,
    limit = 50,
  ) {
    await this.getPackDetail(scope, packId);

    return this.prisma.batteryTelemetry.findMany({
      where: { packId },
      orderBy: { timestamp: 'desc' },
      take: Math.min(limit, 100),
    });
  }

  async getPackSwapHistory(scope: ResolvedProviderScope, packId: string) {
    await this.getPackDetail(scope, packId);

    return this.prisma.swapSession.findMany({
      where: {
        OR: [{ inboundPackId: packId }, { outboundPackId: packId }],
        tenantId: scope.tenantId,
        providerId: scope.providerId,
      },
      orderBy: { startedAt: 'desc' },
      take: 100,
    });
  }

  async quarantinePack(
    scope: ResolvedProviderScope,
    packId: string,
    actorId: string,
    reason?: string,
  ) {
    const pack = await this.getPackDetail(scope, packId);

    const updated = await this.prisma.batteryPack.update({
      where: { id: packId },
      data: {
        status: BatteryPackStatus.QUARANTINED,
        quarantinedAt: new Date(),
      },
    });

    await this.audit.log(
      actorId,
      'pack.quarantine',
      'BATTERY_PACK',
      packId,
      {
        providerId: scope.providerId,
        tenantId: scope.tenantId,
        beforeStatus: pack.status,
        afterStatus: updated.status,
        reason,
      },
    );

    return updated;
  }

  async releasePack(
    scope: ResolvedProviderScope,
    packId: string,
    actorId: string,
    reason?: string,
  ) {
    const pack = await this.getPackDetail(scope, packId);

    if (pack.status !== BatteryPackStatus.QUARANTINED) {
      throw new NotFoundException('Pack is not quarantined');
    }

    const updated = await this.prisma.batteryPack.update({
      where: { id: packId },
      data: {
        status: BatteryPackStatus.READY,
        quarantinedAt: null,
      },
    });

    await this.audit.log(
      actorId,
      'pack.release',
      'BATTERY_PACK',
      packId,
      {
        providerId: scope.providerId,
        tenantId: scope.tenantId,
        beforeStatus: pack.status,
        afterStatus: updated.status,
        reason,
      },
    );

    return updated;
  }

  async markInspected(
    scope: ResolvedProviderScope,
    packId: string,
    actorId: string,
    notes?: string,
  ) {
    await this.getPackDetail(scope, packId);

    await this.audit.log(
      actorId,
      'pack.inspect',
      'BATTERY_PACK',
      packId,
      {
        providerId: scope.providerId,
        tenantId: scope.tenantId,
        notes,
      },
    );

    return { success: true };
  }

  async recommendRetirement(
    scope: ResolvedProviderScope,
    packId: string,
    actorId: string,
    reason?: string,
  ) {
    const pack = await this.getPackDetail(scope, packId);

    const updated = await this.prisma.batteryPack.update({
      where: { id: packId },
      data: {
        status: BatteryPackStatus.RETIRED,
        retiredAt: new Date(),
      },
    });

    await this.audit.log(
      actorId,
      'pack.retire',
      'BATTERY_PACK',
      packId,
      {
        providerId: scope.providerId,
        tenantId: scope.tenantId,
        beforeStatus: pack.status,
        afterStatus: updated.status,
        reason,
      },
    );

    return updated;
  }
}

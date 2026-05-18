import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  BatteryProviderAccessService,
  ResolvedProviderScope,
} from './battery-provider-access.service';
import { CreateMaintenanceDto } from './dto/battery-provider.dto';

@Injectable()
export class BatteryProviderMaintenanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: BatteryProviderAccessService,
    private readonly audit: AuditLogsService,
  ) {}

  async listTickets(
    scope: ResolvedProviderScope,
    filters: {
      status?: string;
      assetType?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const stationWhere = this.accessService.buildProviderStationWhere(scope);
    const stationIds = await this.prisma.station
      .findMany({
        where: stationWhere,
        select: { id: true },
      })
      .then((stations) => stations.map((s) => s.id));

    const conditions: Prisma.IncidentWhereInput[] = [
      { stationId: { in: stationIds } },
    ];

    if (filters.status) {
      conditions.push({ status: filters.status });
    }

    const finalWhere: Prisma.IncidentWhereInput =
      conditions.length > 1 ? { AND: conditions } : conditions[0];

    const page = filters.page ?? 1;
    const limit = Math.min(filters.limit ?? 25, 100);
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.incident.findMany({
        where: finalWhere,
        include: {
          dispatches: true,
          station: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.incident.count({ where: finalWhere }),
    ]);

    return { items, total, page, limit };
  }

  async createTicket(
    scope: ResolvedProviderScope,
    dto: CreateMaintenanceDto,
    actorId: string,
  ) {
    this.accessService.assertStationAccess(scope, dto.stationId);

    const incident = await this.prisma.incident.create({
      data: {
        stationId: dto.stationId,
        title: dto.title,
        description: dto.description || '',
        severity: dto.severity || 'MEDIUM',
        status: 'OPEN',
        assignedTo: dto.assignedTo || null,
      },
    });

    await this.audit.log(
      actorId,
      'maintenance.create',
      'INCIDENT',
      incident.id,
      {
        providerId: scope.providerId,
        tenantId: scope.tenantId,
        assetType: dto.assetType,
        assetId: dto.assetId,
        stationId: dto.stationId,
      },
    );

    return incident;
  }

  async updateTicket(
    scope: ResolvedProviderScope,
    ticketId: string,
    dto: { status?: string; assignedTo?: string; notes?: string },
    actorId: string,
  ) {
    const stationWhere = this.accessService.buildProviderStationWhere(scope);
    const stationIds = await this.prisma.station
      .findMany({
        where: stationWhere,
        select: { id: true },
      })
      .then((stations) => stations.map((s) => s.id));

    const incident = await this.prisma.incident.findFirst({
      where: { id: ticketId, stationId: { in: stationIds } },
    });

    if (!incident) {
      throw new NotFoundException('Maintenance ticket not found');
    }

    const updated = await this.prisma.incident.update({
      where: { id: ticketId },
      data: {
        status: dto.status ?? incident.status,
        assignedTo: dto.assignedTo ?? incident.assignedTo,
      },
    });

    await this.audit.log(actorId, 'maintenance.update', 'INCIDENT', ticketId, {
      providerId: scope.providerId,
      tenantId: scope.tenantId,
      beforeStatus: incident.status,
      afterStatus: updated.status,
      notes: dto.notes,
    });

    return updated;
  }

  async closeTicket(
    scope: ResolvedProviderScope,
    ticketId: string,
    actorId: string,
    resolutionNotes?: string,
  ) {
    const stationWhere = this.accessService.buildProviderStationWhere(scope);
    const stationIds = await this.prisma.station
      .findMany({
        where: stationWhere,
        select: { id: true },
      })
      .then((stations) => stations.map((s) => s.id));

    const incident = await this.prisma.incident.findFirst({
      where: { id: ticketId, stationId: { in: stationIds } },
    });

    if (!incident) {
      throw new NotFoundException('Maintenance ticket not found');
    }

    const updated = await this.prisma.incident.update({
      where: { id: ticketId },
      data: {
        status: 'CLOSED',
      },
    });

    await this.audit.log(actorId, 'maintenance.close', 'INCIDENT', ticketId, {
      providerId: scope.providerId,
      tenantId: scope.tenantId,
      beforeStatus: incident.status,
      afterStatus: updated.status,
      resolutionNotes,
    });

    return updated;
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import {
  BatteryProviderAlertStatus,
  BatteryProviderAlertSeverity,
  BatteryProviderAlertCategory,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  BatteryProviderAccessService,
  ResolvedProviderScope,
} from './battery-provider-access.service';

@Injectable()
export class BatteryProviderAlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: BatteryProviderAccessService,
    private readonly audit: AuditLogsService,
  ) {}

  async listAlerts(
    scope: ResolvedProviderScope,
    filters: {
      status?: string;
      severity?: string;
      category?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const where = this.accessService.buildProviderAlertWhere(scope);
    const conditions: Prisma.BatteryProviderAlertWhereInput[] = [where];

    if (filters.status) {
      conditions.push({ status: filters.status as BatteryProviderAlertStatus });
    }
    if (filters.severity) {
      conditions.push({
        severity: filters.severity as BatteryProviderAlertSeverity,
      });
    }
    if (filters.category) {
      conditions.push({
        category: filters.category as BatteryProviderAlertCategory,
      });
    }

    const finalWhere: Prisma.BatteryProviderAlertWhereInput =
      conditions.length > 1 ? { AND: conditions } : conditions[0];

    const page = filters.page ?? 1;
    const limit = Math.min(filters.limit ?? 25, 100);
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.batteryProviderAlert.findMany({
        where: finalWhere,
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        skip,
        take: limit,
      }),
      this.prisma.batteryProviderAlert.count({ where: finalWhere }),
    ]);

    return { items, total, page, limit };
  }

  async getAlert(scope: ResolvedProviderScope, alertId: string) {
    const alert = await this.prisma.batteryProviderAlert.findFirst({
      where: this.accessService.buildProviderAlertWhere(scope, { id: alertId }),
    });

    if (!alert) {
      throw new NotFoundException('Alert not found');
    }

    return alert;
  }

  async acknowledgeAlert(
    scope: ResolvedProviderScope,
    alertId: string,
    actorId: string,
  ) {
    const alert = await this.getAlert(scope, alertId);

    const updated = await this.prisma.batteryProviderAlert.update({
      where: { id: alertId },
      data: {
        status: BatteryProviderAlertStatus.ACKNOWLEDGED,
        acknowledgedBy: actorId,
        acknowledgedAt: new Date(),
      },
    });

    await this.audit.log(
      actorId,
      'alert.acknowledge',
      'BATTERY_PROVIDER_ALERT',
      alertId,
      {
        providerId: scope.providerId,
        tenantId: scope.tenantId,
        beforeStatus: alert.status,
        afterStatus: updated.status,
      },
    );

    return updated;
  }

  async assignAlert(
    scope: ResolvedProviderScope,
    alertId: string,
    technicianId: string,
    actorId: string,
  ) {
    const alert = await this.getAlert(scope, alertId);

    const updated = await this.prisma.batteryProviderAlert.update({
      where: { id: alertId },
      data: {
        status: BatteryProviderAlertStatus.ASSIGNED,
        assignedToUserId: technicianId,
      },
    });

    await this.audit.log(
      actorId,
      'alert.assign',
      'BATTERY_PROVIDER_ALERT',
      alertId,
      {
        providerId: scope.providerId,
        tenantId: scope.tenantId,
        technicianId,
        beforeStatus: alert.status,
        afterStatus: updated.status,
      },
    );

    return updated;
  }

  async escalateAlert(
    scope: ResolvedProviderScope,
    alertId: string,
    actorId: string,
    reason?: string,
  ) {
    const alert = await this.getAlert(scope, alertId);

    const updated = await this.prisma.batteryProviderAlert.update({
      where: { id: alertId },
      data: {
        status: BatteryProviderAlertStatus.ESCALATED,
        escalatedToOrgId: scope.tenantId,
      },
    });

    await this.audit.log(
      actorId,
      'alert.escalate',
      'BATTERY_PROVIDER_ALERT',
      alertId,
      {
        providerId: scope.providerId,
        tenantId: scope.tenantId,
        escalatedToOrgId: scope.tenantId,
        beforeStatus: alert.status,
        afterStatus: updated.status,
        reason,
      },
    );

    return updated;
  }

  async resolveAlert(
    scope: ResolvedProviderScope,
    alertId: string,
    actorId: string,
    reason?: string,
  ) {
    const alert = await this.getAlert(scope, alertId);

    const updated = await this.prisma.batteryProviderAlert.update({
      where: { id: alertId },
      data: {
        status: BatteryProviderAlertStatus.RESOLVED,
        resolvedBy: actorId,
        resolvedAt: new Date(),
      },
    });

    await this.audit.log(
      actorId,
      'alert.resolve',
      'BATTERY_PROVIDER_ALERT',
      alertId,
      {
        providerId: scope.providerId,
        tenantId: scope.tenantId,
        beforeStatus: alert.status,
        afterStatus: updated.status,
        reason,
      },
    );

    return updated;
  }
}

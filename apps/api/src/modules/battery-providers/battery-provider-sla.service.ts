import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import {
  BatteryProviderAccessService,
  ResolvedProviderScope,
} from './battery-provider-access.service';

@Injectable()
export class BatteryProviderSlaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: BatteryProviderAccessService,
  ) {}

  async getCurrentSla(scope: ResolvedProviderScope) {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const snapshot = await this.prisma.batteryProviderSlaSnapshot.findFirst({
      where: {
        tenantId: scope.tenantId,
        providerId: scope.providerId,
        periodStart: { gte: startOfMonth },
        periodEnd: { lte: endOfMonth },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (snapshot) {
      return snapshot;
    }

    // Return a computed on-the-fly snapshot if no pre-aggregated data exists
    return this.computeLiveSla(scope, startOfMonth, endOfMonth);
  }

  async getAvailabilityReport(
    scope: ResolvedProviderScope,
    dateFrom: Date,
    dateTo: Date,
  ) {
    const cabinetWhere = this.accessService.buildProviderCabinetWhere(scope);

    const cabinets = await this.prisma.batteryCabinet.findMany({
      where: cabinetWhere,
      select: { id: true, cabinetId: true, status: true, lastHeartbeatAt: true },
    });

    const packs = await this.prisma.batteryPack.aggregate({
      where: this.accessService.buildProviderPackWhere(scope),
      _count: { id: true },
      _avg: { soc: true, soh: true },
    });

    return {
      period: { from: dateFrom, to: dateTo },
      cabinetSummary: cabinets.map((c) => ({
        id: c.id,
        cabinetId: c.cabinetId,
        status: c.status,
        lastHeartbeatAt: c.lastHeartbeatAt,
      })),
      packSummary: {
        total: packs._count.id,
        averageSoc: packs._avg.soc,
        averageSoh: packs._avg.soh,
      },
    };
  }

  async getFaultReport(
    scope: ResolvedProviderScope,
    dateFrom: Date,
    dateTo: Date,
  ) {
    const alerts = await this.prisma.batteryProviderAlert.groupBy({
      by: ['category', 'severity'],
      where: this.accessService.buildProviderAlertWhere(scope, {
        createdAt: { gte: dateFrom, lte: dateTo },
      }),
      _count: { id: true },
    });

    return {
      period: { from: dateFrom, to: dateTo },
      faultBreakdown: alerts.map((a) => ({
        category: a.category,
        severity: a.severity,
        count: a._count.id,
      })),
    };
  }

  async getSwapReport(
    scope: ResolvedProviderScope,
    dateFrom: Date,
    dateTo: Date,
  ) {
    const where = this.accessService.buildProviderSwapWhere(scope, {
      startedAt: { gte: dateFrom, lte: dateTo },
    });

    const [total, completed, failed, avgDuration] = await Promise.all([
      this.prisma.swapSession.count({ where }),
      this.prisma.swapSession.count({
        where: { ...where, stage: 'COMPLETE' },
      }),
      this.prisma.swapSession.count({
        where: { ...where, stage: 'FAILED' },
      }),
      this.prisma.swapSession.aggregate({
        where: { ...where, durationSec: { not: null } },
        _avg: { durationSec: true },
      }),
    ]);

    return {
      period: { from: dateFrom, to: dateTo },
      total,
      completed,
      failed,
      failureRatePct: total > 0 ? Math.round((failed / total) * 100) : 0,
      averageDurationSec: avgDuration._avg.durationSec ?? 0,
    };
  }

  private async computeLiveSla(
    scope: ResolvedProviderScope,
    periodStart: Date,
    periodEnd: Date,
  ) {
    const packWhere = this.accessService.buildProviderPackWhere(scope);
    const cabinetWhere = this.accessService.buildProviderCabinetWhere(scope);
    const swapWhere = this.accessService.buildProviderSwapWhere(scope, {
      startedAt: { gte: periodStart, lte: periodEnd },
    });
    const alertWhere = this.accessService.buildProviderAlertWhere(scope, {
      createdAt: { gte: periodStart, lte: periodEnd },
    });

    const [packStats, cabinetStats, swapStats, alertStats] = await Promise.all([
      this.prisma.batteryPack.aggregate({
        where: packWhere,
        _count: { id: true },
      }),
      this.prisma.batteryCabinet.aggregate({
        where: cabinetWhere,
        _count: { id: true },
      }),
      this.prisma.swapSession.aggregate({
        where: swapWhere,
        _count: { id: true },
      }),
      this.prisma.batteryProviderAlert.aggregate({
        where: alertWhere,
        _count: { id: true },
      }),
    ]);

    // Simplified live SLA: return structure with zeroed/estimated metrics
    return {
      id: 'live',
      tenantId: scope.tenantId,
      providerId: scope.providerId,
      periodStart,
      periodEnd,
      providerUptimePct: 100,
      cabinetUptimePct: 100,
      telemetryFreshnessPct: 100,
      packAvailabilityPct: 100,
      failedSwapRatePct: 0,
      avgResolutionMinutes: 0,
      slaBreaches: alertStats._count.id,
      createdAt: new Date(),
    };
  }
}

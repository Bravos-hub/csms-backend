import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import {
  BatteryProviderAccessService,
  ResolvedProviderScope,
} from './battery-provider-access.service';

export interface ProviderOverviewKpis {
  assignedStations: number;
  activeCabinets: number;
  activePacks: number;
  readyPacks: number;
  faultedPacks: number;
  averageSoc: number | null;
  averageSoh: number | null;
  telemetryFreshnessPct: number;
  openCriticalAlerts: number;
  swapReadinessScore: number;
}

@Injectable()
export class BatteryProviderDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: BatteryProviderAccessService,
  ) {}

  async getOverview(scope: ResolvedProviderScope): Promise<ProviderOverviewKpis> {
    const stationWhere = this.accessService.buildProviderStationWhere(scope);
    const cabinetWhere = this.accessService.buildProviderCabinetWhere(scope, {
      status: { not: 'MAINTENANCE' },
    });
    const packWhere = this.accessService.buildProviderPackWhere(scope);

    const [assignedStations, activeCabinets, packStats, criticalAlerts, telemetryFreshness] =
      await Promise.all([
        this.prisma.station.count({ where: stationWhere }),
        this.prisma.batteryCabinet.count({ where: cabinetWhere }),
        this.prisma.batteryPack.aggregate({
          where: packWhere,
          _count: { id: true },
          _avg: { soc: true, soh: true },
        }),
        this.prisma.batteryProviderAlert.count({
          where: this.accessService.buildProviderAlertWhere(scope, {
            status: { not: 'RESOLVED' },
            severity: 'CRITICAL',
          }),
        }),
        this.computeTelemetryFreshness(scope),
      ]);

    const [readyPacks, faultedPacks] = await Promise.all([
      this.prisma.batteryPack.count({
        where: this.accessService.buildProviderPackWhere(scope, {
          status: 'READY',
        }),
      }),
      this.prisma.batteryPack.count({
        where: this.accessService.buildProviderPackWhere(scope, {
          status: 'FAULTED',
        }),
      }),
    ]);

    const activePacks = packStats._count.id;
    const averageSoc = packStats._avg.soc ?? null;
    const averageSoh = packStats._avg.soh ?? null;

    const swapReadinessScore = this.computeReadinessScore({
      readyPacks,
      activePacks,
      averageSoc,
      averageSoh,
      activeCabinets,
      assignedStations,
      faultedPacks,
      telemetryFreshnessPct: telemetryFreshness,
    });

    return {
      assignedStations,
      activeCabinets,
      activePacks,
      readyPacks,
      faultedPacks,
      averageSoc,
      averageSoh,
      telemetryFreshnessPct: telemetryFreshness,
      openCriticalAlerts: criticalAlerts,
      swapReadinessScore,
    };
  }

  private async computeTelemetryFreshness(
    scope: ResolvedProviderScope,
  ): Promise<number> {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const packWhere = this.accessService.buildProviderPackWhere(scope);

    const [totalPacks, freshPacks] = await Promise.all([
      this.prisma.batteryPack.count({ where: packWhere }),
      this.prisma.batteryPack.count({
        where: {
          ...packWhere,
          lastTelemetryAt: { gte: fiveMinutesAgo },
        },
      }),
    ]);

    if (totalPacks === 0) return 100;
    return Math.round((freshPacks / totalPacks) * 100);
  }

  private computeReadinessScore(inputs: {
    readyPacks: number;
    activePacks: number;
    averageSoc: number | null;
    averageSoh: number | null;
    activeCabinets: number;
    assignedStations: number;
    faultedPacks: number;
    telemetryFreshnessPct: number;
  }): number {
    if (inputs.activePacks === 0 && inputs.assignedStations === 0) {
      return 0;
    }

    const readyPackRatio =
      inputs.activePacks > 0 ? inputs.readyPacks / inputs.activePacks : 0;
    const avgSocNormalized = Math.min((inputs.averageSoc ?? 0) / 100, 1);
    const avgSohNormalized = Math.min((inputs.averageSoh ?? 0) / 100, 1);
    const cabinetOnlineRatio =
      inputs.assignedStations > 0
        ? Math.min(inputs.activeCabinets / inputs.assignedStations, 1)
        : 0;
    const faultPenalty = Math.min(inputs.faultedPacks / 10, 1); // cap at 10 faulted packs = full penalty
    const telemetryFreshnessNormalized = inputs.telemetryFreshnessPct / 100;

    const score =
      readyPackRatio * 30 +
      avgSocNormalized * 20 +
      avgSohNormalized * 20 +
      cabinetOnlineRatio * 15 +
      (1 - faultPenalty) * 10 +
      telemetryFreshnessNormalized * 5;

    return Math.round(Math.max(0, Math.min(100, score)));
  }
}

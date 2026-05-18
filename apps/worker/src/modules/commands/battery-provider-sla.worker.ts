import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma.service';
import { WorkerMetricsService } from '../observability/worker-metrics.service';

@Injectable()
export class BatteryProviderSlaWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BatteryProviderSlaWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly metrics: WorkerMetricsService,
  ) {}

  onModuleInit(): void {
    const enabled = this.getBoolean('BATTERY_PROVIDER_SLA_ENABLED', true);
    if (!enabled) {
      this.logger.log('Battery provider SLA worker disabled');
      return;
    }

    const intervalMs = this.getInt(
      'BATTERY_PROVIDER_SLA_INTERVAL_MS',
      24 * 60 * 60 * 1000,
    );
    const computeHourUtc = this.getInt(
      'BATTERY_PROVIDER_SLA_COMPUTE_HOUR_UTC',
      0,
    );

    // Schedule the first tick to align with the target UTC hour
    const now = new Date();
    const target = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        computeHourUtc,
        5,
        0,
      ),
    );
    if (target.getTime() <= now.getTime()) {
      target.setUTCDate(target.getUTCDate() + 1);
    }
    const initialDelay = target.getTime() - now.getTime();

    setTimeout(() => {
      void this.tick();
      this.timer = setInterval(() => {
        void this.tick();
      }, intervalMs);
    }, initialDelay);

    this.logger.log(
      `SLA worker scheduled. First run at ${target.toISOString()}`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private getBoolean(key: string, fallback: boolean): boolean {
    const raw = this.config.get<string>(key);
    if (!raw) return fallback;
    return raw.trim().toLowerCase() === 'true';
  }

  private getInt(key: string, fallback: number): number {
    const raw = this.config.get<string>(key);
    if (!raw) return fallback;
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const startedAt = Date.now();

    try {
      const assignments = await this.prisma.batteryProviderAssignment.findMany({
        where: { status: 'ACTIVE' },
        select: {
          id: true,
          tenantId: true,
          providerId: true,
          assignedStationIds: true,
          assignedCabinetIds: true,
        },
      });

      // Previous calendar day
      const now = new Date();
      const periodEnd = new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate(),
          0,
          0,
          0,
        ),
      );
      const periodStart = new Date(periodEnd);
      periodStart.setUTCDate(periodStart.getUTCDate() - 1);

      let snapshotsCreated = 0;

      for (const assignment of assignments) {
        try {
          await this.computeAndStoreSnapshot(
            assignment.tenantId,
            assignment.providerId,
            assignment.assignedStationIds,
            assignment.assignedCabinetIds,
            periodStart,
            periodEnd,
          );
          snapshotsCreated++;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.warn(
            `SLA snapshot failed for provider ${assignment.providerId}: ${message}`,
          );
        }
      }

      this.metrics.increment('battery_provider_sla_compute_runs_total');
      this.metrics.increment(
        'battery_provider_sla_snapshots_created_total',
        snapshotsCreated,
      );
      this.metrics.observeLatency(
        'battery_provider_sla_compute_latency_ms',
        Date.now() - startedAt,
      );

      this.logger.log(
        `SLA computation completed (assignments=${assignments.length}, snapshots=${snapshotsCreated}, period=${periodStart.toISOString()} to ${periodEnd.toISOString()})`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.metrics.increment('battery_provider_sla_compute_fail_total');
      this.logger.error(`SLA computation failed: ${message}`);
    } finally {
      this.running = false;
    }
  }

  private async computeAndStoreSnapshot(
    tenantId: string,
    providerId: string,
    assignedStationIds: string[],
    assignedCabinetIds: string[],
    periodStart: Date,
    periodEnd: Date,
  ): Promise<void> {
    const stationFilter =
      assignedStationIds.length > 0 ? { in: assignedStationIds } : undefined;
    const cabinetFilter =
      assignedCabinetIds.length > 0 ? { in: assignedCabinetIds } : undefined;

    const fiveMinutesAgo = new Date(periodEnd.getTime() - 5 * 60 * 1000);

    // 1. Cabinet uptime
    const cabinetWhere: Record<string, unknown> = {
      tenantId,
      providerId,
      ...(stationFilter ? { stationId: stationFilter } : {}),
      ...(cabinetFilter ? { id: cabinetFilter } : {}),
    };

    const [totalCabinets, onlineCabinets] = await Promise.all([
      this.prisma.batteryCabinet.count({ where: cabinetWhere }),
      this.prisma.batteryCabinet.count({
        where: {
          ...cabinetWhere,
          isOnline: true,
        },
      }),
    ]);

    const cabinetUptimePct =
      totalCabinets > 0
        ? Math.round((onlineCabinets / totalCabinets) * 100)
        : 100;

    // 2. Pack metrics
    const packWhere: Record<string, unknown> = {
      providerId,
      ...(stationFilter ? { stationId: stationFilter } : {}),
      ...(cabinetFilter ? { cabinetId: cabinetFilter } : {}),
    };

    const [totalPacks, readyPacks, freshPacks] = await Promise.all([
      this.prisma.batteryPack.count({ where: packWhere }),
      this.prisma.batteryPack.count({
        where: { ...packWhere, status: 'READY' },
      }),
      this.prisma.batteryPack.count({
        where: {
          ...packWhere,
          lastTelemetryAt: { gte: fiveMinutesAgo },
        },
      }),
    ]);

    const packAvailabilityPct =
      totalPacks > 0 ? Math.round((readyPacks / totalPacks) * 100) : 100;

    const telemetryFreshnessPct =
      totalPacks > 0 ? Math.round((freshPacks / totalPacks) * 100) : 100;

    // 3. Provider uptime = at least one cabinet online
    const providerUptimePct = totalCabinets > 0 && onlineCabinets > 0 ? 100 : 0;

    // 4. Swap failure rate
    const swapWhere: Record<string, unknown> = {
      tenantId,
      providerId,
      ...(stationFilter ? { stationId: stationFilter } : {}),
      startedAt: { gte: periodStart, lt: periodEnd },
    };

    const [totalSwaps, failedSwaps] = await Promise.all([
      this.prisma.swapSession.count({ where: swapWhere }),
      this.prisma.swapSession.count({
        where: { ...swapWhere, stage: 'FAILED' },
      }),
    ]);

    const failedSwapRatePct =
      totalSwaps > 0 ? Math.round((failedSwaps / totalSwaps) * 100) : 0;

    // 5. Average resolution time & SLA breaches
    const alerts = await this.prisma.batteryProviderAlert.findMany({
      where: {
        tenantId,
        providerId,
        createdAt: { gte: periodStart, lt: periodEnd },
      },
      select: {
        firstSeenAt: true,
        resolvedAt: true,
        severity: true,
      },
    });

    let totalResolutionMinutes = 0;
    let resolvedCount = 0;
    let slaBreaches = 0;

    for (const alert of alerts) {
      if (alert.severity === 'CRITICAL' || alert.severity === 'HIGH') {
        slaBreaches++;
      }
      if (alert.firstSeenAt && alert.resolvedAt) {
        totalResolutionMinutes +=
          (alert.resolvedAt.getTime() - alert.firstSeenAt.getTime()) /
          (60 * 1000);
        resolvedCount++;
      }
    }

    const avgResolutionMinutes =
      resolvedCount > 0
        ? Math.round(totalResolutionMinutes / resolvedCount)
        : 0;

    // Upsert snapshot
    await this.prisma.batteryProviderSlaSnapshot.upsert({
      where: {
        tenantId_providerId_periodStart: {
          tenantId,
          providerId,
          periodStart,
        },
      },
      update: {
        providerUptimePct,
        cabinetUptimePct,
        telemetryFreshnessPct,
        packAvailabilityPct,
        failedSwapRatePct,
        avgResolutionMinutes,
        slaBreaches,
        periodEnd,
      },
      create: {
        tenantId,
        providerId,
        periodStart,
        periodEnd,
        providerUptimePct,
        cabinetUptimePct,
        telemetryFreshnessPct,
        packAvailabilityPct,
        failedSwapRatePct,
        avgResolutionMinutes,
        slaBreaches,
      },
    });
  }
}

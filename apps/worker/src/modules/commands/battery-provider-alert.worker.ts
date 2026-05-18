import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BatteryProviderAlertCategory,
  BatteryProviderAlertSeverity,
  BatteryProviderAlertStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { WorkerMetricsService } from '../observability/worker-metrics.service';

@Injectable()
export class BatteryProviderAlertWorker
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(BatteryProviderAlertWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly metrics: WorkerMetricsService,
  ) {}

  async onModuleInit(): Promise<void> {
    const enabled = this.getBoolean('BATTERY_PROVIDER_ALERTS_ENABLED', true);
    if (!enabled) {
      this.logger.log('Battery provider alert worker disabled');
      return;
    }

    const intervalMs = this.getInt(
      'BATTERY_PROVIDER_ALERTS_INTERVAL_MS',
      5 * 60 * 1000,
    );
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);

    await this.tick();
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

      let totalCreated = 0;
      let totalDeduped = 0;

      for (const assignment of assignments) {
        const result = await this.evaluateAssignment(assignment);
        totalCreated += result.created;
        totalDeduped += result.deduped;
      }

      this.metrics.increment('battery_provider_alert_compute_runs_total');
      this.metrics.increment(
        'battery_provider_alerts_created_total',
        totalCreated,
      );
      this.metrics.increment(
        'battery_provider_alerts_deduplicated_total',
        totalDeduped,
      );
      this.metrics.observeLatency(
        'battery_provider_alert_compute_latency_ms',
        Date.now() - startedAt,
      );

      this.logger.log(
        `Alert evaluation completed (assignments=${assignments.length}, created=${totalCreated}, deduped=${totalDeduped})`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.metrics.increment('battery_provider_alert_compute_fail_total');
      this.logger.error(`Alert evaluation failed: ${message}`);
    } finally {
      this.running = false;
    }
  }

  private async evaluateAssignment(assignment: {
    tenantId: string;
    providerId: string;
    assignedStationIds: string[];
    assignedCabinetIds: string[];
  }): Promise<{ created: number; deduped: number }> {
    let created = 0;
    let deduped = 0;
    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

    // Build scoped where clauses
    const stationFilter =
      assignment.assignedStationIds.length > 0
        ? { in: assignment.assignedStationIds }
        : undefined;
    const cabinetFilter =
      assignment.assignedCabinetIds.length > 0
        ? { in: assignment.assignedCabinetIds }
        : undefined;

    // 1. Stale telemetry
    try {
      const stalePacks = await this.prisma.batteryPack.findMany({
        where: {
          providerId: assignment.providerId,
          ...(stationFilter ? { stationId: stationFilter } : {}),
          ...(cabinetFilter ? { cabinetId: cabinetFilter } : {}),
          OR: [
            { lastTelemetryAt: { lt: fiveMinutesAgo } },
            { lastTelemetryAt: null },
          ],
        },
        select: { id: true, serialNumber: true, stationId: true },
      });

      for (const pack of stalePacks) {
        const result = await this.upsertAlert({
          tenantId: assignment.tenantId,
          providerId: assignment.providerId,
          category: BatteryProviderAlertCategory.STALE_TELEMETRY,
          severity: BatteryProviderAlertSeverity.HIGH,
          assetType: 'PACK',
          assetId: pack.id,
          message: `Pack ${pack.serialNumber} telemetry is stale`,
        });
        if (result === 'created') created++;
        else if (result === 'deduped') deduped++;
      }
    } catch (err) {
      this.logger.warn(
        `Stale telemetry check failed for provider ${assignment.providerId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // 2. Pack health degradation
    try {
      const degradedPacks = await this.prisma.batteryPack.findMany({
        where: {
          providerId: assignment.providerId,
          ...(stationFilter ? { stationId: stationFilter } : {}),
          ...(cabinetFilter ? { cabinetId: cabinetFilter } : {}),
          OR: [{ soh: { lt: 70 } }, { soc: { lt: 10 } }],
        },
        select: { id: true, serialNumber: true, soh: true, soc: true },
      });

      for (const pack of degradedPacks) {
        let severity: BatteryProviderAlertSeverity =
          BatteryProviderAlertSeverity.MEDIUM;
        if ((pack.soh ?? 100) < 60)
          severity = BatteryProviderAlertSeverity.CRITICAL;
        else if ((pack.soh ?? 100) < 70)
          severity = BatteryProviderAlertSeverity.HIGH;
        else if ((pack.soc ?? 100) < 10)
          severity = BatteryProviderAlertSeverity.MEDIUM;

        const result = await this.upsertAlert({
          tenantId: assignment.tenantId,
          providerId: assignment.providerId,
          category: BatteryProviderAlertCategory.PACK_DEGRADATION,
          severity,
          assetType: 'PACK',
          assetId: pack.id,
          message: `Pack ${pack.serialNumber} health degraded (SOH ${pack.soh ?? 'N/A'}%, SOC ${pack.soc ?? 'N/A'}%)`,
        });
        if (result === 'created') created++;
        else if (result === 'deduped') deduped++;
      }
    } catch (err) {
      this.logger.warn(
        `Pack degradation check failed for provider ${assignment.providerId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // 3. Cabinet offline
    try {
      const offlineCabinets = await this.prisma.batteryCabinet.findMany({
        where: {
          tenantId: assignment.tenantId,
          providerId: assignment.providerId,
          ...(stationFilter ? { stationId: stationFilter } : {}),
          ...(cabinetFilter ? { id: cabinetFilter } : {}),
          OR: [
            { lastHeartbeatAt: { lt: fiveMinutesAgo } },
            { isOnline: false },
          ],
        },
        select: { id: true, cabinetId: true },
      });

      for (const cabinet of offlineCabinets) {
        const result = await this.upsertAlert({
          tenantId: assignment.tenantId,
          providerId: assignment.providerId,
          category: BatteryProviderAlertCategory.CABINET_FAULT,
          severity: BatteryProviderAlertSeverity.HIGH,
          assetType: 'CABINET',
          assetId: cabinet.id,
          message: `Cabinet ${cabinet.cabinetId} is offline or unresponsive`,
        });
        if (result === 'created') created++;
        else if (result === 'deduped') deduped++;
      }
    } catch (err) {
      this.logger.warn(
        `Cabinet offline check failed for provider ${assignment.providerId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // 4. Swap failures
    try {
      const failedSwaps = await this.prisma.swapSession.findMany({
        where: {
          tenantId: assignment.tenantId,
          providerId: assignment.providerId,
          ...(stationFilter ? { stationId: stationFilter } : {}),
          stage: 'FAILED',
          startedAt: { gte: fiveMinutesAgo },
        },
        select: { id: true, sessionId: true },
      });

      for (const swap of failedSwaps) {
        const result = await this.upsertAlert({
          tenantId: assignment.tenantId,
          providerId: assignment.providerId,
          category: BatteryProviderAlertCategory.SWAP_FAILURE,
          severity: BatteryProviderAlertSeverity.HIGH,
          assetType: 'SESSION',
          assetId: swap.id,
          message: `Swap session ${swap.sessionId} failed`,
        });
        if (result === 'created') created++;
        else if (result === 'deduped') deduped++;
      }
    } catch (err) {
      this.logger.warn(
        `Swap failure check failed for provider ${assignment.providerId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // 5. Maintenance overdue
    try {
      const overduePacks = await this.prisma.batteryPack.findMany({
        where: {
          providerId: assignment.providerId,
          ...(stationFilter ? { stationId: stationFilter } : {}),
          ...(cabinetFilter ? { cabinetId: cabinetFilter } : {}),
          status: 'MAINTENANCE',
        },
        select: { id: true, serialNumber: true },
      });

      for (const pack of overduePacks) {
        const recentIncident = await this.prisma.incident.findFirst({
          where: {
            stationId: {
              in:
                assignment.assignedStationIds.length > 0
                  ? assignment.assignedStationIds
                  : undefined,
            },
            createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
          },
          orderBy: { createdAt: 'desc' },
        });

        if (!recentIncident) {
          const result = await this.upsertAlert({
            tenantId: assignment.tenantId,
            providerId: assignment.providerId,
            category: BatteryProviderAlertCategory.MAINTENANCE_OVERDUE,
            severity: BatteryProviderAlertSeverity.MEDIUM,
            assetType: 'PACK',
            assetId: pack.id,
            message: `Pack ${pack.serialNumber} in maintenance without recent incident`,
          });
          if (result === 'created') created++;
          else if (result === 'deduped') deduped++;
        }
      }
    } catch (err) {
      this.logger.warn(
        `Maintenance overdue check failed for provider ${assignment.providerId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return { created, deduped };
  }

  private async upsertAlert(payload: {
    tenantId: string;
    providerId: string;
    category: BatteryProviderAlertCategory;
    severity: BatteryProviderAlertSeverity;
    assetType: string;
    assetId: string;
    message: string;
  }): Promise<'created' | 'deduped' | 'skipped'> {
    const existing = await this.prisma.batteryProviderAlert.findFirst({
      where: {
        providerId: payload.providerId,
        category: payload.category,
        assetId: payload.assetId,
        status: {
          in: [
            BatteryProviderAlertStatus.OPEN,
            BatteryProviderAlertStatus.ACKNOWLEDGED,
            BatteryProviderAlertStatus.ASSIGNED,
          ],
        },
      },
    });

    if (existing) {
      await this.prisma.batteryProviderAlert.update({
        where: { id: existing.id },
        data: { lastSeenAt: new Date() },
      });
      return 'deduped';
    }

    await this.prisma.batteryProviderAlert.create({
      data: {
        tenantId: payload.tenantId,
        providerId: payload.providerId,
        category: payload.category,
        severity: payload.severity,
        status: BatteryProviderAlertStatus.OPEN,
        assetType: payload.assetType,
        assetId: payload.assetId,
        message: payload.message,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      },
    });

    return 'created';
  }
}

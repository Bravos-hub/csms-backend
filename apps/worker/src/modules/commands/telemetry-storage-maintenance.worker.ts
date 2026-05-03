import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { WorkerMetricsService } from '../observability/worker-metrics.service';

type PartitionFlagRow = {
  partitioned: boolean;
};

function assertSafeSqlIdentifier(value: string, label: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Invalid SQL identifier for ${label}: ${value}`);
  }
  return value;
}

@Injectable()
export class TelemetryStorageMaintenanceWorker
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(TelemetryStorageMaintenanceWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly metrics: WorkerMetricsService,
  ) {}

  async onModuleInit(): Promise<void> {
    const enabled = this.getBoolean('TELEMETRY_STORAGE_MAINTENANCE_ENABLED', true);
    if (!enabled) {
      this.logger.log('Telemetry storage maintenance is disabled');
      return;
    }

    const intervalMs = this.getInt(
      'TELEMETRY_STORAGE_MAINTENANCE_INTERVAL_MS',
      60 * 60 * 1000,
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
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return fallback;
    const rounded = Math.floor(parsed);
    return rounded > 0 ? rounded : fallback;
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const startedAt = Date.now();

    try {
      const retentionDays = this.getInt('TELEMETRY_RAW_RETENTION_DAYS', 90);
      const retentionBatchSize = this.getInt(
        'TELEMETRY_RETENTION_BATCH_SIZE',
        2000,
      );
      const partitionMonthsAhead = this.getInt(
        'TELEMETRY_PARTITION_MONTHS_AHEAD',
        3,
      );

      const removed = await this.deleteOldSnapshots(
        retentionDays,
        retentionBatchSize,
      );
      const partitionsCreated = await this.ensureSnapshotPartitions(
        partitionMonthsAhead,
      );
      const ingestHealth = await this.computeIngestHealth();

      this.metrics.increment('telemetry_storage_maintenance_runs_total');
      this.metrics.increment(
        'telemetry_storage_retention_deleted_snapshots_total',
        removed,
      );
      this.metrics.increment(
        'telemetry_storage_partitions_created_total',
        partitionsCreated,
      );
      this.metrics.setGauge('telemetry_ingest_lag_max_ms', ingestHealth.maxLagMs);
      this.metrics.setGauge(
        'telemetry_ingest_stale_vehicle_count',
        ingestHealth.staleVehicleCount,
      );
      this.metrics.observeLatency(
        'telemetry_storage_maintenance_latency_ms',
        Date.now() - startedAt,
      );

      this.logger.log(
        `Telemetry maintenance completed (deleted=${removed}, partitionsCreated=${partitionsCreated}, maxLagMs=${ingestHealth.maxLagMs}, staleVehicles=${ingestHealth.staleVehicleCount})`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.metrics.increment('telemetry_storage_maintenance_fail_total');
      this.logger.error(`Telemetry maintenance failed: ${message}`);
    } finally {
      this.running = false;
    }
  }

  private async deleteOldSnapshots(
    retentionDays: number,
    batchSize: number,
  ): Promise<number> {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    let deletedTotal = 0;

    while (true) {
      const rows = await this.prisma.vehicleTelemetrySnapshot.findMany({
        where: { collectedAt: { lt: cutoff } },
        orderBy: { collectedAt: 'asc' },
        take: batchSize,
        select: { id: true },
      });
      if (rows.length === 0) {
        break;
      }

      const deleted = await this.prisma.vehicleTelemetrySnapshot.deleteMany({
        where: { id: { in: rows.map((row) => row.id) } },
      });
      deletedTotal += deleted.count;

      if (rows.length < batchSize) {
        break;
      }
    }

    return deletedTotal;
  }

  private async ensureSnapshotPartitions(monthsAhead: number): Promise<number> {
    const tableName = assertSafeSqlIdentifier(
      'vehicle_telemetry_snapshots',
      'snapshot table name',
    );
    const isPartitioned = await this.isPartitionedTable(tableName);
    this.metrics.setGauge(
      'telemetry_snapshot_table_partitioned',
      isPartitioned ? 1 : 0,
    );
    if (!isPartitioned) {
      return 0;
    }

    let created = 0;
    const firstMonth = new Date();
    firstMonth.setUTCDate(1);
    firstMonth.setUTCHours(0, 0, 0, 0);

    for (let i = 0; i <= monthsAhead; i += 1) {
      const start = new Date(firstMonth);
      start.setUTCMonth(start.getUTCMonth() + i);
      const end = new Date(start);
      end.setUTCMonth(end.getUTCMonth() + 1);
      const yyyymm = `${start.getUTCFullYear()}${String(start.getUTCMonth() + 1).padStart(2, '0')}`;
      const partitionName = assertSafeSqlIdentifier(
        `${tableName}_p${yyyymm}`,
        'snapshot partition name',
      );

      const existed = await this.partitionExists(partitionName);
      await this.prisma.$executeRaw(
        Prisma.sql`CREATE TABLE IF NOT EXISTS ${Prisma.raw(`"${partitionName}"`)}
        PARTITION OF ${Prisma.raw(`"${tableName}"`)}
        FOR VALUES FROM (${start.toISOString()}) TO (${end.toISOString()})`,
      );
      if (!existed) {
        created += 1;
      }
    }

    return created;
  }

  private async isPartitionedTable(tableName: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<PartitionFlagRow[]>`
      SELECT EXISTS (
        SELECT 1
        FROM pg_partitioned_table pt
        JOIN pg_class c ON c.oid = pt.partrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = ${tableName}
          AND n.nspname = current_schema()
      ) AS partitioned
    `;
    return rows[0]?.partitioned === true;
  }

  private async partitionExists(partitionName: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<PartitionFlagRow[]>`
      SELECT EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = ${partitionName}
          AND n.nspname = current_schema()
      ) AS partitioned
    `;
    return rows[0]?.partitioned === true;
  }

  private async computeIngestHealth(): Promise<{
    maxLagMs: number;
    staleVehicleCount: number;
  }> {
    const staleThresholdMs = this.getInt(
      'TELEMETRY_STALENESS_ALERT_THRESHOLD_MS',
      600_000,
    );
    const latestRows = await this.prisma.vehicleTelemetryLatest.findMany({
      select: {
        vehicleId: true,
        lastSyncedAt: true,
        sampledAt: true,
      },
    });

    let maxLagMs = 0;
    let staleVehicleCount = 0;
    const now = Date.now();

    for (const row of latestRows) {
      const reference =
        row.lastSyncedAt instanceof Date
          ? row.lastSyncedAt
          : row.sampledAt instanceof Date
            ? row.sampledAt
            : null;
      const lagMs = reference ? Math.max(0, now - reference.getTime()) : 0;
      if (lagMs > maxLagMs) {
        maxLagMs = lagMs;
      }
      if (lagMs > staleThresholdMs) {
        staleVehicleCount += 1;
      }
    }

    return {
      maxLagMs,
      staleVehicleCount,
    };
  }
}

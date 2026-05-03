import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma.service';
import { WorkerMetricsService } from '../observability/worker-metrics.service';
import { TelemetryStorageMaintenanceWorker } from './telemetry-storage-maintenance.worker';

describe('TelemetryStorageMaintenanceWorker', () => {
  const config = {
    get: jest.fn(),
  };

  const prisma = {
    vehicleTelemetrySnapshot: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    vehicleTelemetryLatest: {
      findMany: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
  };

  const metrics = {
    increment: jest.fn(),
    setGauge: jest.fn(),
    observeLatency: jest.fn(),
  };

  const worker = new TelemetryStorageMaintenanceWorker(
    config as unknown as ConfigService<Record<string, unknown>>,
    prisma as unknown as PrismaService,
    metrics as unknown as WorkerMetricsService,
  );

  beforeEach(() => {
    config.get.mockReset();
    prisma.vehicleTelemetrySnapshot.findMany.mockReset();
    prisma.vehicleTelemetrySnapshot.deleteMany.mockReset();
    prisma.vehicleTelemetryLatest.findMany.mockReset();
    prisma.$queryRaw.mockReset();
    prisma.$executeRaw.mockReset();
    metrics.increment.mockReset();
    metrics.setGauge.mockReset();
    metrics.observeLatency.mockReset();
    config.get.mockReturnValue(undefined);
    prisma.$executeRaw.mockResolvedValue(0);
  });

  afterEach(() => {
    worker.onModuleDestroy();
  });

  it('does not start maintenance when feature flag is disabled', async () => {
    config.get.mockImplementation((key: string) =>
      key === 'TELEMETRY_STORAGE_MAINTENANCE_ENABLED' ? 'false' : undefined,
    );
    const tickSpy = jest.spyOn(
      worker as unknown as { tick: () => Promise<void> },
      'tick',
    );

    await worker.onModuleInit();

    expect(tickSpy).not.toHaveBeenCalled();
    tickSpy.mockRestore();
  });

  it('deletes raw telemetry snapshots in batches', async () => {
    prisma.vehicleTelemetrySnapshot.findMany
      .mockResolvedValueOnce([{ id: 'snap-1' }, { id: 'snap-2' }])
      .mockResolvedValueOnce([{ id: 'snap-3' }]);
    prisma.vehicleTelemetrySnapshot.deleteMany
      .mockResolvedValueOnce({ count: 2 })
      .mockResolvedValueOnce({ count: 1 });

    const deleteOldSnapshots = Reflect.get(
      worker as object,
      'deleteOldSnapshots',
    ) as (retentionDays: number, batchSize: number) => Promise<number>;

    const deleted = await deleteOldSnapshots.call(worker, 90, 2);

    expect(prisma.vehicleTelemetrySnapshot.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.vehicleTelemetrySnapshot.deleteMany).toHaveBeenNthCalledWith(1, {
      where: { id: { in: ['snap-1', 'snap-2'] } },
    });
    expect(prisma.vehicleTelemetrySnapshot.deleteMany).toHaveBeenNthCalledWith(2, {
      where: { id: { in: ['snap-3'] } },
    });
    expect(deleted).toBe(3);
  });

  it('computes max ingest lag and stale vehicle count', async () => {
    const now = Date.now();
    prisma.vehicleTelemetryLatest.findMany.mockResolvedValue([
      {
        vehicleId: 'veh-1',
        lastSyncedAt: new Date(now - 1_000),
        sampledAt: new Date(now - 1_000),
      },
      {
        vehicleId: 'veh-2',
        lastSyncedAt: new Date(now - 700_000),
        sampledAt: new Date(now - 700_000),
      },
    ]);

    const computeIngestHealth = Reflect.get(
      worker as object,
      'computeIngestHealth',
    ) as () => Promise<{ maxLagMs: number; staleVehicleCount: number }>;

    const health = await computeIngestHealth.call(worker);

    expect(health.maxLagMs).toBeGreaterThanOrEqual(700_000);
    expect(health.staleVehicleCount).toBe(1);
  });

  it('treats rows with missing timestamps as zero-lag instead of throwing', async () => {
    prisma.vehicleTelemetryLatest.findMany.mockResolvedValue([
      {
        vehicleId: 'veh-null-1',
        lastSyncedAt: null,
        sampledAt: null,
      },
    ]);

    const computeIngestHealth = Reflect.get(
      worker as object,
      'computeIngestHealth',
    ) as () => Promise<{ maxLagMs: number; staleVehicleCount: number }>;

    const health = await computeIngestHealth.call(worker);

    expect(health).toEqual({
      maxLagMs: 0,
      staleVehicleCount: 0,
    });
  });

  it('creates missing telemetry snapshot partitions only when table is partitioned', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([{ partitioned: true }])
      .mockResolvedValueOnce([{ partitioned: false }])
      .mockResolvedValueOnce([{ partitioned: true }]);

    const ensureSnapshotPartitions = Reflect.get(
      worker as object,
      'ensureSnapshotPartitions',
    ) as (monthsAhead: number) => Promise<number>;

    const created = await ensureSnapshotPartitions.call(worker, 1);

    expect(metrics.setGauge).toHaveBeenCalledWith(
      'telemetry_snapshot_table_partitioned',
      1,
    );
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
    expect(created).toBe(1);
  });
});

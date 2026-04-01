import { CommandOutboxWorker } from './command-outbox.worker';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma.service';
import { KafkaService } from '../../platform/kafka.service';
import { WorkerMetricsService } from '../observability/worker-metrics.service';
import { WorkerTenantRoutingService } from './worker-tenant-routing.service';

describe('CommandOutboxWorker tenant routing', () => {
  const config = {
    get: jest.fn(),
  };

  const prisma = {
    chargePoint: {
      findUnique: jest.fn(),
    },
  };

  const kafka = {};
  const metrics = {
    increment: jest.fn(),
    setGauge: jest.fn(),
    observeLatency: jest.fn(),
  };

  const tenantRouting = {
    runWithTenant: jest.fn(),
  };

  const worker = new CommandOutboxWorker(
    config as unknown as ConfigService<Record<string | symbol, unknown>>,
    prisma as unknown as PrismaService,
    kafka as unknown as KafkaService,
    metrics as unknown as WorkerMetricsService,
    tenantRouting as unknown as WorkerTenantRoutingService,
  );

  beforeEach(() => {
    prisma.chargePoint.findUnique.mockReset();
    tenantRouting.runWithTenant.mockReset();
  });

  it('resolves charge point within tenant execution context when command has tenantId', async () => {
    prisma.chargePoint.findUnique.mockResolvedValue({
      id: 'cp-1',
      ocppId: 'OCPP-1',
    });

    tenantRouting.runWithTenant.mockImplementation(
      async (_tenantId: string, operation: () => Promise<unknown>) =>
        operation(),
    );

    const resolveTargetOcppId = Reflect.get(
      worker as object,
      'resolveTargetOcppId',
    ) as (
      command: {
        id: string;
        tenantId: string | null;
        chargePointId: string;
        stationId: string;
      },
      outbox: { id: string },
    ) => Promise<string | null>;

    const targetOcppId = await resolveTargetOcppId.call(
      worker,
      {
        id: 'cmd-1',
        tenantId: 'org-tenant-1',
        chargePointId: 'cp-1',
        stationId: 'st-1',
      },
      {
        id: 'outbox-1',
      },
    );

    expect(tenantRouting.runWithTenant).toHaveBeenCalledWith(
      'org-tenant-1',
      expect.any(Function),
    );
    expect(prisma.chargePoint.findUnique).toHaveBeenCalledWith({
      where: { id: 'cp-1' },
    });
    expect(targetOcppId).toBe('OCPP-1');
  });
});

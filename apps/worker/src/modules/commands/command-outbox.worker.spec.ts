import { CommandOutboxWorker } from './command-outbox.worker';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma.service';
import { KafkaService } from '../../platform/kafka.service';
import { WorkerMetricsService } from '../observability/worker-metrics.service';
import { WorkerTenantRoutingService } from './worker-tenant-routing.service';
import { KAFKA_TOPICS } from '../../contracts/kafka-topics';
import { validateCommandRequestContract } from '../../contracts/commands';

describe('CommandOutboxWorker tenant routing', () => {
  const config = {
    get: jest.fn(),
  };

  const prisma = {
    command: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    commandOutbox: {
      update: jest.fn(),
    },
    commandEvent: {
      create: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
    chargePoint: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const kafka = {
    publish: jest.fn(),
    checkConnection: jest.fn(),
  };
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
    config.get.mockReset();
    prisma.chargePoint.findUnique.mockReset();
    prisma.command.findUnique.mockReset();
    prisma.commandOutbox.update.mockReset();
    prisma.command.update.mockReset();
    prisma.commandEvent.create.mockReset();
    prisma.auditLog.create.mockReset();
    prisma.$transaction.mockReset();
    tenantRouting.runWithTenant.mockReset();
    kafka.publish.mockReset();
    kafka.checkConnection.mockReset();
    metrics.increment.mockReset();
    metrics.observeLatency.mockReset();
    metrics.setGauge.mockReset();

    config.get.mockReturnValue(undefined);
    prisma.$transaction.mockImplementation(
      async (
        operation: (tx: {
          commandOutbox: { update: typeof prisma.commandOutbox.update };
          command: { update: typeof prisma.command.update };
          commandEvent: { create: typeof prisma.commandEvent.create };
          auditLog: { create: typeof prisma.auditLog.create };
        }) => Promise<unknown>,
      ) =>
        operation({
          commandOutbox: prisma.commandOutbox,
          command: prisma.command,
          commandEvent: prisma.commandEvent,
          auditLog: prisma.auditLog,
        }),
    );
    tenantRouting.runWithTenant.mockImplementation(
      async (_tenantId: string | null | undefined, operation: () => Promise<unknown>) =>
        operation(),
    );
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

  it('publishes VEHICLE domain commands through vehicle lifecycle path', async () => {
    prisma.command.findUnique.mockResolvedValue({
      id: 'cmd-veh-1',
      commandType: 'LOCK',
      domain: 'VEHICLE',
      provider: 'MOCK',
      vehicleId: 'veh-1',
      providerCommandId: null,
      requestedAt: new Date('2026-05-02T08:00:00.000Z'),
      tenantId: null,
    });

    const publish = Reflect.get(worker as object, 'publish') as (outbox: {
      id: string;
      commandId: string;
      attempts: number;
    }) => Promise<void>;

    await publish.call(worker, {
      id: 'outbox-veh-1',
      commandId: 'cmd-veh-1',
      attempts: 1,
    });

    expect(prisma.commandOutbox.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'outbox-veh-1' },
        data: expect.objectContaining({ status: 'Published', lockedAt: null }),
      }),
    );
    expect(prisma.command.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cmd-veh-1' },
        data: expect.objectContaining({
          status: 'Confirmed',
          providerCommandId: expect.any(String),
        }),
      }),
    );
    expect(prisma.commandEvent.create).toHaveBeenCalledTimes(2);
  });

  it('dead-letters unsupported VEHICLE command types through failure handler', async () => {
    prisma.command.findUnique.mockResolvedValue({
      id: 'cmd-veh-2',
      commandType: 'FLASH_LIGHTS',
      domain: 'VEHICLE',
      provider: 'MOCK',
      vehicleId: 'veh-2',
      providerCommandId: null,
      requestedAt: new Date('2026-05-02T08:10:00.000Z'),
      tenantId: null,
    });

    const failureSpy = jest
      .spyOn(
        worker as unknown as {
          handlePublishFailure: (
            outbox: { id: string; commandId: string; attempts: number },
            message: string,
          ) => Promise<void>;
        },
        'handlePublishFailure',
      )
      .mockResolvedValue(undefined);

    const publish = Reflect.get(worker as object, 'publish') as (outbox: {
      id: string;
      commandId: string;
      attempts: number;
    }) => Promise<void>;

    await publish.call(worker, {
      id: 'outbox-veh-2',
      commandId: 'cmd-veh-2',
      attempts: 2,
    });

    expect(failureSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'outbox-veh-2' }),
      expect.stringContaining('Unsupported vehicle command type'),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    failureSpy.mockRestore();
  });

  it('schedules retry when charge-point publish fails before max attempts', async () => {
    prisma.command.findUnique.mockResolvedValue({
      id: 'cmd-cp-1',
      commandType: 'RemoteStartTransaction',
      domain: 'CHARGE_POINT',
      provider: 'MOCK',
      stationId: 'station-1',
      chargePointId: 'cp-1',
      connectorId: null,
      payload: {},
      correlationId: null,
      requestedBy: 'user-1',
      requestedAt: new Date('2026-05-02T09:00:00.000Z'),
      idempotencyTtlSec: null,
      tenantId: null,
    });
    prisma.chargePoint.findUnique.mockResolvedValue({
      id: 'cp-1',
      ocppId: 'OCPP-CP-1',
    });
    kafka.publish.mockRejectedValueOnce(new Error('provider timeout'));

    const publish = Reflect.get(worker as object, 'publish') as (outbox: {
      id: string;
      commandId: string;
      attempts: number;
    }) => Promise<void>;

    await publish.call(worker, {
      id: 'outbox-cp-1',
      commandId: 'cmd-cp-1',
      attempts: 1,
    });

    expect(prisma.commandOutbox.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'outbox-cp-1' },
        data: expect.objectContaining({
          status: 'Queued',
          lockedAt: null,
          lastError: 'provider timeout',
        }),
      }),
    );
    expect(prisma.commandEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          commandId: 'cmd-cp-1',
          status: 'RetryScheduled',
        }),
      }),
    );
    expect(metrics.increment).toHaveBeenCalledWith('outbox_publish_fail_total');
    expect(metrics.increment).toHaveBeenCalledWith('outbox_retry_scheduled_total');
    expect(metrics.increment).not.toHaveBeenCalledWith('outbox_dead_letter_total');
  });

  it('dead-letters exhausted charge-point publishes and records dead-letter publish failures', async () => {
    prisma.command.findUnique.mockResolvedValue({
      id: 'cmd-cp-2',
      commandType: 'RemoteStopTransaction',
      domain: 'CHARGE_POINT',
      provider: 'MOCK',
      stationId: 'station-2',
      chargePointId: 'cp-2',
      connectorId: null,
      payload: {},
      correlationId: 'corr-2',
      requestedBy: 'user-2',
      requestedAt: new Date('2026-05-02T09:30:00.000Z'),
      idempotencyTtlSec: null,
      tenantId: null,
    });
    prisma.chargePoint.findUnique.mockResolvedValue({
      id: 'cp-2',
      ocppId: 'OCPP-CP-2',
    });
    kafka.publish
      .mockRejectedValueOnce(new Error('provider timeout'))
      .mockRejectedValueOnce(new Error('dead-letter broker timeout'));

    const publish = Reflect.get(worker as object, 'publish') as (outbox: {
      id: string;
      commandId: string;
      attempts: number;
    }) => Promise<void>;

    await publish.call(worker, {
      id: 'outbox-cp-2',
      commandId: 'cmd-cp-2',
      attempts: 5,
    });

    expect(prisma.commandOutbox.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'outbox-cp-2' },
        data: expect.objectContaining({
          status: 'DeadLettered',
          lockedAt: null,
          lastError: 'provider timeout',
        }),
      }),
    );
    expect(prisma.command.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cmd-cp-2' },
        data: expect.objectContaining({
          status: 'Failed',
          error: 'provider timeout',
        }),
      }),
    );
    expect(prisma.commandEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          commandId: 'cmd-cp-2',
          status: 'DeadLettered',
        }),
      }),
    );
    expect(kafka.publish).toHaveBeenNthCalledWith(
      1,
      KAFKA_TOPICS.commandRequests,
      expect.any(String),
      'OCPP-CP-2',
    );
    expect(kafka.publish).toHaveBeenNthCalledWith(
      2,
      KAFKA_TOPICS.commandDeadLetters,
      expect.any(String),
      'cmd-cp-2',
    );
    expect(metrics.increment).toHaveBeenCalledWith('outbox_dead_letter_total');
    expect(metrics.increment).toHaveBeenCalledWith(
      'outbox_dead_letter_publish_fail_total',
    );
    expect(metrics.increment).not.toHaveBeenCalledWith(
      'outbox_retry_scheduled_total',
    );
  });

  it('publishes engine-compatible command request payloads for charge-point commands', async () => {
    prisma.command.findUnique.mockResolvedValue({
      id: 'cmd-contract-1',
      commandType: 'RemoteStartTransaction',
      domain: 'CHARGE_POINT',
      provider: 'MOCK',
      stationId: 'station-contract',
      chargePointId: 'cp-contract-1',
      connectorId: '1',
      payload: { idTag: 'TAG-1' },
      correlationId: 'corr-contract-1',
      requestedBy: 'user-contract-1',
      requestedAt: new Date('2026-05-02T10:00:00.000Z'),
      idempotencyTtlSec: 300,
      tenantId: 'org-contract-1',
    });
    prisma.chargePoint.findUnique.mockResolvedValue({
      id: 'cp-contract-1',
      ocppId: 'OCPP-CONTRACT-1',
    });
    kafka.publish.mockResolvedValue(undefined);

    const publish = Reflect.get(worker as object, 'publish') as (outbox: {
      id: string;
      commandId: string;
      attempts: number;
    }) => Promise<void>;

    await publish.call(worker, {
      id: 'outbox-contract-1',
      commandId: 'cmd-contract-1',
      attempts: 1,
    });

    const publishCalls = kafka.publish.mock.calls as Array<
      [string, string, string]
    >;
    const [topic, payloadJson, key] = publishCalls[0];
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;
    const contractValidation = validateCommandRequestContract(payload);

    expect(topic).toBe(KAFKA_TOPICS.commandRequests);
    expect(key).toBe('OCPP-CONTRACT-1');
    expect(contractValidation.ok).toBe(true);
    expect(payload).toEqual(
      expect.objectContaining({
        commandId: 'cmd-contract-1',
        commandType: 'RemoteStartTransaction',
        stationId: 'station-contract',
        tenantId: 'org-contract-1',
        chargePointId: 'OCPP-CONTRACT-1',
        connectorId: 1,
        dedupeKey: 'corr-contract-1',
        idempotencyTtlSec: 300,
      }),
    );
  });
});

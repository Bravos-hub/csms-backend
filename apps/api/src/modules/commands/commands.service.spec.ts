import { CommandsService } from './commands.service';
import { PrismaService } from '../../prisma.service';
import { TenantContextService } from '@app/db';

describe('CommandsService', () => {
  const previousFirmwareFlag =
    process.env.FEATURE_OCPP_FIRMWARE_COMMANDS_ENABLED;
  const prisma = {
    command: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    commandOutbox: {
      create: jest.fn(),
    },
    commandEvent: {
      create: jest.fn(),
    },
  };

  const tenantContext = {
    get: jest.fn(),
  };

  const service = new CommandsService(
    prisma as unknown as PrismaService,
    tenantContext as unknown as TenantContextService,
  );

  beforeEach(() => {
    process.env.FEATURE_OCPP_FIRMWARE_COMMANDS_ENABLED = previousFirmwareFlag;
    prisma.command.create.mockReset();
    prisma.command.findFirst.mockReset();
    prisma.command.findMany.mockReset();
    prisma.command.findUnique.mockReset();
    prisma.commandOutbox.create.mockReset();
    prisma.commandEvent.create.mockReset();
    tenantContext.get.mockReset();
  });

  it('persists tenantId from request-scoped context when enqueueing commands', async () => {
    tenantContext.get.mockReturnValue({
      effectiveOrganizationId: 'org-tenant-1',
      authenticatedOrganizationId: 'org-tenant-fallback',
    });
    prisma.command.create.mockResolvedValue({});
    prisma.commandOutbox.create.mockResolvedValue({});
    prisma.commandEvent.create.mockResolvedValue({});

    const result = await service.enqueueCommand({
      commandType: 'RemoteStart',
      chargePointId: 'cp-1',
      payload: { idTag: 'TAG-1' },
      requestedBy: { userId: 'user-1', orgId: 'org-body' },
    });

    const createCalls = prisma.command.create.mock.calls as Array<[unknown]>;
    const createCallArg = createCalls[0]?.[0] as {
      data?: {
        tenantId?: string | null;
        chargePointId?: string;
        commandType?: string;
      };
    };
    expect(createCallArg.data?.tenantId).toBe('org-tenant-1');
    expect(createCallArg.data?.chargePointId).toBe('cp-1');
    expect(createCallArg.data?.commandType).toBe('RemoteStart');

    const commandEventCalls = prisma.commandEvent.create.mock.calls as Array<
      [unknown]
    >;
    const commandEventCallArg = commandEventCalls[0]?.[0] as {
      data?: {
        payload?: Record<string, unknown>;
      };
    };
    expect(commandEventCallArg.data?.payload).toEqual(
      expect.objectContaining({ tenantId: 'org-tenant-1' }),
    );

    expect(result.status).toBe('Queued');
    expect(result.commandId).toBeTruthy();
  });

  it('returns existing command for replayed correlation id within idempotency window', async () => {
    tenantContext.get.mockReturnValue({
      effectiveOrganizationId: 'org-tenant-1',
      authenticatedOrganizationId: 'org-tenant-fallback',
    });

    const existingRequestedAt = new Date('2026-04-11T12:00:00.000Z');
    prisma.command.findFirst.mockResolvedValue({
      id: 'cmd-existing',
      status: 'Queued',
      requestedAt: existingRequestedAt,
    });

    const result = await service.enqueueCommand({
      commandType: 'ApplyChargingLimit',
      chargePointId: 'cp-1',
      payload: { limitAmps: 16 },
      requestedBy: { userId: 'user-1', orgId: 'org-body' },
      correlationId: 'corr-123',
      idempotencyTtlSec: 300,
    });

    const findFirstCalls = prisma.command.findFirst.mock.calls as Array<
      [
        {
          where?: {
            tenantId?: string | null;
            correlationId?: string;
            requestedAt?: {
              gte?: Date;
            };
          };
          orderBy?: {
            requestedAt?: 'asc' | 'desc';
          };
          select?: {
            id?: boolean;
            status?: boolean;
            requestedAt?: boolean;
          };
        },
      ]
    >;
    const findFirstCallArg = findFirstCalls[0]?.[0];

    expect(findFirstCallArg?.where?.tenantId).toBe('org-tenant-1');
    expect(findFirstCallArg?.where?.correlationId).toBe('corr-123');
    expect(findFirstCallArg?.where?.requestedAt?.gte).toBeInstanceOf(Date);
    expect(findFirstCallArg?.orderBy?.requestedAt).toBe('desc');
    expect(findFirstCallArg?.select).toEqual({
      id: true,
      status: true,
      requestedAt: true,
    });
    expect(prisma.command.create).not.toHaveBeenCalled();
    expect(prisma.commandOutbox.create).not.toHaveBeenCalled();
    expect(prisma.commandEvent.create).not.toHaveBeenCalled();
    expect(result).toEqual({
      commandId: 'cmd-existing',
      status: 'Queued',
      requestedAt: existingRequestedAt.toISOString(),
    });
  });

  afterAll(() => {
    if (previousFirmwareFlag === undefined) {
      delete process.env.FEATURE_OCPP_FIRMWARE_COMMANDS_ENABLED;
    } else {
      process.env.FEATURE_OCPP_FIRMWARE_COMMANDS_ENABLED = previousFirmwareFlag;
    }
  });

  it('lists command lifecycle records for a charge point', async () => {
    prisma.command.findMany.mockResolvedValue([
      {
        id: 'cmd-1',
        stationId: 'station-1',
        chargePointId: 'cp-1',
        connectorId: '1',
        commandType: 'RemoteStart',
        status: 'Dispatched',
        requestedAt: new Date('2026-03-16T12:00:00.000Z'),
        sentAt: new Date('2026-03-16T12:00:02.000Z'),
        completedAt: null,
        error: null,
      },
    ]);

    const result = await service.listCommands({
      chargePointId: 'cp-1',
      stationId: 'station-1',
      limit: 10,
    });

    expect(prisma.command.findMany).toHaveBeenCalledWith({
      where: { chargePointId: 'cp-1', stationId: 'station-1' },
      orderBy: { requestedAt: 'desc' },
      take: 10,
      select: {
        id: true,
        stationId: true,
        chargePointId: true,
        connectorId: true,
        commandType: true,
        status: true,
        requestedAt: true,
        sentAt: true,
        completedAt: true,
        error: true,
      },
    });
    expect(result).toEqual([
      {
        id: 'cmd-1',
        stationId: 'station-1',
        chargePointId: 'cp-1',
        connectorId: '1',
        commandType: 'RemoteStart',
        status: 'Dispatched',
        requestedAt: '2026-03-16T12:00:00.000Z',
        sentAt: '2026-03-16T12:00:02.000Z',
        completedAt: null,
        error: null,
      },
    ]);
  });

  it('returns null for unknown command ids', async () => {
    prisma.command.findUnique.mockResolvedValue(null);

    const result = await service.getCommandById('missing');
    expect(result).toBeNull();
  });

  it('rejects UpdateFirmware commands when feature flag is disabled', async () => {
    process.env.FEATURE_OCPP_FIRMWARE_COMMANDS_ENABLED = 'false';
    const disabledService = new CommandsService(
      prisma as unknown as PrismaService,
      tenantContext as unknown as TenantContextService,
    );

    await expect(
      disabledService.enqueueCommand({
        commandType: 'UpdateFirmware',
        chargePointId: 'cp-1',
        payload: {
          location: 'https://firmware.example.com/fw.bin',
          retrieveAt: '2026-04-06T10:00:00.000Z',
        },
        requestedBy: {},
      }),
    ).rejects.toThrow(
      'Firmware update commands are disabled by FEATURE_OCPP_FIRMWARE_COMMANDS_ENABLED',
    );

    expect(prisma.command.create).not.toHaveBeenCalled();
  });

  it('enqueues UpdateFirmware commands when feature flag is enabled', async () => {
    process.env.FEATURE_OCPP_FIRMWARE_COMMANDS_ENABLED = 'true';
    const enabledService = new CommandsService(
      prisma as unknown as PrismaService,
      tenantContext as unknown as TenantContextService,
    );
    prisma.command.create.mockResolvedValue({});
    prisma.commandOutbox.create.mockResolvedValue({});
    prisma.commandEvent.create.mockResolvedValue({});

    const result = await enabledService.enqueueCommand({
      commandType: 'UpdateFirmware',
      chargePointId: 'cp-1',
      stationId: 'station-1',
      payload: {
        location: 'https://firmware.example.com/fw.bin',
        retrieveAt: '2026-04-06T10:00:00.000Z',
      },
      requestedBy: {},
    });

    expect(result.status).toBe('Queued');
    const createCalls = prisma.command.create.mock.calls as Array<[unknown]>;
    const createCallArg = createCalls[0]?.[0] as {
      data?: { commandType?: string };
    };
    expect(createCallArg?.data?.commandType).toBe('UpdateFirmware');
  });
});

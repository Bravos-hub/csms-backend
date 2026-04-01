import { CommandsService } from './commands.service';

describe('CommandsService', () => {
  const prisma = {
    command: {
      create: jest.fn(),
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

  const service = new CommandsService(prisma as any, tenantContext as any);

  beforeEach(() => {
    prisma.command.create.mockReset();
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
});

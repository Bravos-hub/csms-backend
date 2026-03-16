import { CommandsService } from './commands.service';

describe('CommandsService', () => {
  const prisma = {
    command: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
  };

  const service = new CommandsService(prisma as any);

  beforeEach(() => {
    prisma.command.findMany.mockReset();
    prisma.command.findUnique.mockReset();
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

import { CommandsService } from './commands.service';

describe('CommandsService', () => {
  const previousFirmwareFlag = process.env.FEATURE_OCPP_FIRMWARE_COMMANDS_ENABLED;
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

  const service = new CommandsService(prisma as any);

  beforeEach(() => {
    process.env.FEATURE_OCPP_FIRMWARE_COMMANDS_ENABLED = previousFirmwareFlag;
    prisma.command.create.mockReset();
    prisma.command.findMany.mockReset();
    prisma.command.findUnique.mockReset();
    prisma.commandOutbox.create.mockReset();
    prisma.commandEvent.create.mockReset();
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
    const disabledService = new CommandsService(prisma as any);

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
    const enabledService = new CommandsService(prisma as any);
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
    expect(prisma.command.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          commandType: 'UpdateFirmware',
        }),
      }),
    );
  });
});

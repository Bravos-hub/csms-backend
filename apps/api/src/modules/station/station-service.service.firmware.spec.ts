/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment */
import { StationService } from './station-service.service';

describe('StationService firmware commands and history', () => {
  const previousFirmwareCommandFlag =
    process.env.FEATURE_OCPP_FIRMWARE_COMMANDS_ENABLED;

  const prisma = {
    chargePoint: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    firmwareUpdateEvent: {
      findMany: jest.fn(),
    },
    ocpiPartnerLocation: {
      findMany: jest.fn(),
    },
    station: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
  };

  const provisioningService = {
    provision: jest.fn(),
  };

  const commands = {
    enqueueCommand: jest.fn(),
  };

  const ocpiService = {
    getChargePointRoamingPublication: jest.fn(),
    setChargePointRoamingPublication: jest.fn(),
  };
  const energyManagement = {
    recalculateStation: jest.fn(),
  };
  const tenantGuardrails = {
    requireTenantScope: jest
      .fn()
      .mockResolvedValue({ tenantId: 'tenant-1', cpoType: 'CHARGE' }),
    buildOwnedStationWhere: jest.fn((_: unknown, extra?: unknown) => extra),
    buildOwnedChargePointWhere: jest.fn((_: unknown, extra?: unknown) => extra),
    listOwnedStationIds: jest.fn().mockResolvedValue(['station-1']),
  };

  const createService = () =>
    new StationService(
      prisma as any,
      provisioningService as any,
      commands as any,
      ocpiService as any,
      energyManagement as any,
      tenantGuardrails as any,
    );

  beforeEach(() => {
    process.env.FEATURE_OCPP_FIRMWARE_COMMANDS_ENABLED =
      previousFirmwareCommandFlag;
    prisma.chargePoint.findFirst.mockReset();
    prisma.chargePoint.findUnique.mockReset();
    prisma.firmwareUpdateEvent.findMany.mockReset();
    prisma.ocpiPartnerLocation.findMany.mockReset();
    prisma.ocpiPartnerLocation.findMany.mockResolvedValue([]);
    commands.enqueueCommand.mockReset();
    ocpiService.getChargePointRoamingPublication.mockReset();
    ocpiService.setChargePointRoamingPublication.mockReset();
    energyManagement.recalculateStation.mockReset();
    tenantGuardrails.requireTenantScope.mockReset();
    tenantGuardrails.requireTenantScope.mockResolvedValue({
      tenantId: 'tenant-1',
      cpoType: 'CHARGE',
    });
    tenantGuardrails.buildOwnedStationWhere.mockClear();
    tenantGuardrails.buildOwnedChargePointWhere.mockClear();
    tenantGuardrails.listOwnedStationIds.mockReset();
    tenantGuardrails.listOwnedStationIds.mockResolvedValue(['station-1']);
  });

  afterAll(() => {
    if (previousFirmwareCommandFlag === undefined) {
      delete process.env.FEATURE_OCPP_FIRMWARE_COMMANDS_ENABLED;
    } else {
      process.env.FEATURE_OCPP_FIRMWARE_COMMANDS_ENABLED =
        previousFirmwareCommandFlag;
    }
  });

  it('queues UpdateFirmware command from canonical DTO when feature is enabled', async () => {
    process.env.FEATURE_OCPP_FIRMWARE_COMMANDS_ENABLED = 'true';
    const service = createService();
    prisma.chargePoint.findFirst.mockResolvedValue({
      id: 'cp-1',
      stationId: 'station-1',
    });
    commands.enqueueCommand.mockResolvedValue({
      commandId: 'cmd-1',
      status: 'Queued',
      requestedAt: '2026-04-06T10:00:00.000Z',
    });

    const result = await service.updateFirmware('cp-1', {
      location: 'https://firmware.example.com/fw.bin',
      retrieveAt: '2026-04-06T10:00:00.000Z',
      installAt: '2026-04-06T11:00:00.000Z',
      retries: 2,
      retryIntervalSec: 30,
      requestId: 12345,
    });

    expect(commands.enqueueCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        commandType: 'UpdateFirmware',
        chargePointId: 'cp-1',
        payload: expect.objectContaining({
          location: 'https://firmware.example.com/fw.bin',
          requestId: 12345,
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        commandId: 'cmd-1',
        commandType: 'UpdateFirmware',
      }),
    );
  });

  it('rejects UpdateFirmware command when feature is disabled', async () => {
    process.env.FEATURE_OCPP_FIRMWARE_COMMANDS_ENABLED = 'false';
    const service = createService();

    await expect(
      service.updateFirmware('cp-1', {
        location: 'https://firmware.example.com/fw.bin',
        retrieveAt: '2026-04-06T10:00:00.000Z',
      }),
    ).rejects.toThrow(
      'Firmware update commands are disabled by FEATURE_OCPP_FIRMWARE_COMMANDS_ENABLED',
    );
    expect(commands.enqueueCommand).not.toHaveBeenCalled();
  });

  it('reads firmware event history for a charge point', async () => {
    process.env.FEATURE_OCPP_FIRMWARE_COMMANDS_ENABLED = 'true';
    const service = createService();
    prisma.chargePoint.findFirst.mockResolvedValue({
      id: 'cp-1',
      stationId: 'station-1',
    });
    prisma.firmwareUpdateEvent.findMany.mockResolvedValue([
      {
        id: 'evt-1',
        gatewayEventId: 'gw-1',
        chargePointId: 'cp-1',
        stationId: 'station-1',
        ocppVersion: '2.0.1',
        requestId: 11,
        status: 'Installing',
        payload: { status: 'Installing' },
        occurredAt: new Date('2026-04-06T10:30:00.000Z'),
        createdAt: new Date('2026-04-06T10:30:01.000Z'),
      },
    ]);

    const result = await service.getFirmwareEvents('cp-1', {
      limit: 10,
      from: '2026-04-06T00:00:00.000Z',
      to: '2026-04-07T00:00:00.000Z',
    });

    expect(prisma.firmwareUpdateEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          chargePointId: 'cp-1',
        }),
        take: 10,
      }),
    );
    expect(result[0]).toEqual(
      expect.objectContaining({
        gatewayEventId: 'gw-1',
        status: 'Installing',
        occurredAt: '2026-04-06T10:30:00.000Z',
      }),
    );
  });
});

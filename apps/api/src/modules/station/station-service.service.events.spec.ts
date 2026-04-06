import { StationService } from './station-service.service';

describe('StationService station event normalization', () => {
  const previousFirmwareStatusFlag =
    process.env.FEATURE_OCPP_FIRMWARE_STATUS_PERSIST_ENABLED;
  const prisma = {
    chargePoint: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    firmwareUpdateEvent: {
      upsert: jest.fn(),
      findMany: jest.fn(),
    },
    station: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const provisioningService = {
    provision: jest.fn(),
  };

  const commands = {
    enqueueCommand: jest.fn(),
  };

  const createService = () =>
    new StationService(
      prisma as any,
      provisioningService as any,
      commands as any,
    );

  beforeEach(() => {
    process.env.FEATURE_OCPP_FIRMWARE_STATUS_PERSIST_ENABLED =
      previousFirmwareStatusFlag;
    prisma.chargePoint.findUnique.mockReset();
    prisma.chargePoint.update.mockReset();
    prisma.firmwareUpdateEvent.upsert.mockReset();
    prisma.$transaction.mockReset();
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
  });

  afterAll(() => {
    if (previousFirmwareStatusFlag === undefined) {
      delete process.env.FEATURE_OCPP_FIRMWARE_STATUS_PERSIST_ENABLED;
    } else {
      process.env.FEATURE_OCPP_FIRMWARE_STATUS_PERSIST_ENABLED =
        previousFirmwareStatusFlag;
    }
  });

  it('handles gateway domain heartbeat events and normalizes OCPP version', async () => {
    const service = createService();
    prisma.chargePoint.findUnique.mockResolvedValue({
      id: 'cp-1',
      ocppVersion: '1.6',
    });
    prisma.chargePoint.update.mockResolvedValue({});

    await service.handleOcppMessage({
      eventType: 'StationHeartbeat',
      chargePointId: 'CP-001',
      ocppVersion: '1.6J',
      payload: {
        action: 'Heartbeat',
        payload: {},
      },
    });

    expect(prisma.chargePoint.findUnique).toHaveBeenCalledWith({
      where: { ocppId: 'CP-001' },
    });
    expect(prisma.chargePoint.update).toHaveBeenCalledWith({
      where: { id: 'cp-1' },
      data: expect.objectContaining({
        status: 'Online',
        ocppVersion: '1.6',
      }),
    });
  });

  it('persists FirmwareStatusNotification snapshot and history when feature flag is enabled', async () => {
    process.env.FEATURE_OCPP_FIRMWARE_STATUS_PERSIST_ENABLED = 'true';
    const service = createService();
    prisma.chargePoint.findUnique.mockResolvedValue({
      id: 'cp-1',
      stationId: 'station-1',
      ocppVersion: '2.0.1',
    });
    prisma.chargePoint.update.mockResolvedValue({});
    prisma.firmwareUpdateEvent.upsert.mockResolvedValue({});

    await service.handleOcppMessage({
      eventId: 'evt-fw-1',
      occurredAt: '2026-04-06T10:30:00.000Z',
      eventType: 'FirmwareStatusNotification',
      chargePointId: 'CP-001',
      ocppVersion: '2.0.1',
      payload: {
        action: 'FirmwareStatusNotification',
        payload: {
          status: 'Installing',
          requestId: 9001,
        },
      },
    });

    expect(prisma.chargePoint.update).toHaveBeenCalledWith({
      where: { id: 'cp-1' },
      data: expect.objectContaining({
        firmwareUpdateStatus: 'Installing',
        firmwareUpdateRequestId: 9001,
      }),
    });
    expect(prisma.firmwareUpdateEvent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { gatewayEventId: 'evt-fw-1' },
        create: expect.objectContaining({
          chargePointId: 'cp-1',
          stationId: 'station-1',
          status: 'Installing',
          requestId: 9001,
        }),
      }),
    );
  });

  it('ignores FirmwareStatusNotification persistence when feature flag is disabled', async () => {
    process.env.FEATURE_OCPP_FIRMWARE_STATUS_PERSIST_ENABLED = 'false';
    const service = createService();
    prisma.chargePoint.findUnique.mockResolvedValue({
      id: 'cp-1',
      stationId: 'station-1',
      ocppVersion: '2.0.1',
    });

    await service.handleOcppMessage({
      eventId: 'evt-fw-2',
      eventType: 'FirmwareStatusNotification',
      chargePointId: 'CP-001',
      ocppVersion: '2.0.1',
      payload: {
        action: 'FirmwareStatusNotification',
        payload: {
          status: 'Installed',
        },
      },
    });

    expect(prisma.chargePoint.update).not.toHaveBeenCalled();
    expect(prisma.firmwareUpdateEvent.upsert).not.toHaveBeenCalled();
  });
});

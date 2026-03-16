import { StationService } from './station-service.service';

describe('StationService station event normalization', () => {
  const prisma = {
    chargePoint: {
      findUnique: jest.fn(),
      update: jest.fn(),
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

  const service = new StationService(
    prisma as any,
    provisioningService as any,
    commands as any,
  );

  beforeEach(() => {
    prisma.chargePoint.findUnique.mockReset();
    prisma.chargePoint.update.mockReset();
  });

  it('handles gateway domain heartbeat events and normalizes OCPP version', async () => {
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
});

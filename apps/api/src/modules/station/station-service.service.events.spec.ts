import { StationService } from './station-service.service';
import { PrismaService } from '../../prisma.service';
import { ChargerProvisioningService } from './provisioning/charger-provisioning.service';
import { CommandsService } from '../commands/commands.service';

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
    prisma as unknown as PrismaService,
    provisioningService as unknown as ChargerProvisioningService,
    commands as unknown as CommandsService,
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
    const updateCalls = prisma.chargePoint.update.mock.calls as unknown[][];
    const updateArg = updateCalls[0]?.[0] as
      | {
          where: { id: string };
          data: { status: string; ocppVersion: string };
        }
      | undefined;

    expect(updateArg).toBeDefined();
    expect(updateArg?.where).toEqual({ id: 'cp-1' });
    expect(updateArg?.data).toMatchObject({
      status: 'Online',
      ocppVersion: '1.6',
    });
  });
});

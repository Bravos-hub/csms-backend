jest.mock('../../prisma.service', () => ({
  PrismaService: class PrismaServiceMock {},
}));

jest.mock('./provisioning/charger-provisioning.service', () => ({
  ChargerProvisioningService: class ChargerProvisioningServiceMock {},
}));

import { StationService } from './station-service.service';

describe('StationService charge point listing', () => {
  const prisma = {
    chargePoint: {
      findMany: jest.fn(),
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
    prisma.chargePoint.findMany.mockReset();
    prisma.chargePoint.findMany.mockResolvedValue([]);
  });

  it('includes the parent station name for fleet management views', async () => {
    await service.findAllChargePoints();

    expect(prisma.chargePoint.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: {
          station: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      }),
    );
  });

  it('applies station and status filters when provided', async () => {
    await service.findAllChargePoints({
      stationId: 'st-101',
      status: 'online',
    });

    expect(prisma.chargePoint.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          stationId: 'st-101',
          status: {
            in: expect.arrayContaining([
              'online',
              'Online',
              'ONLINE',
              'available',
              'Available',
              'AVAILABLE',
            ]),
          },
        },
      }),
    );
  });
});

/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment */
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
      findUnique: jest.fn(),
    },
    ocpiPartnerLocation: {
      findMany: jest.fn(),
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

  const service = new StationService(
    prisma as any,
    provisioningService as any,
    commands as any,
    ocpiService as any,
  );

  beforeEach(() => {
    prisma.chargePoint.findMany.mockReset();
    prisma.chargePoint.findMany.mockResolvedValue([]);
    prisma.chargePoint.findUnique.mockReset();
    prisma.chargePoint.findUnique.mockResolvedValue(null);
    prisma.ocpiPartnerLocation.findMany.mockReset();
    prisma.ocpiPartnerLocation.findMany.mockResolvedValue([]);
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

  it('surfaces roaming publication status in list responses', async () => {
    prisma.chargePoint.findMany.mockResolvedValueOnce([
      {
        id: 'cp-1',
        stationId: 'st-101',
        ocppId: 'CP-001',
        status: 'Online',
        station: { id: 'st-101', name: 'Station A' },
      },
    ]);
    prisma.ocpiPartnerLocation.findMany.mockResolvedValueOnce([
      { locationId: 'cp-1' },
    ]);

    const result = await service.findAllChargePoints();

    expect(result[0]).toEqual(
      expect.objectContaining({
        id: 'cp-1',
        roamingPublished: true,
      }),
    );
  });

  it('surfaces roaming publication status in detail responses', async () => {
    prisma.chargePoint.findUnique.mockResolvedValueOnce({
      id: 'cp-2',
      stationId: 'st-102',
      ocppId: 'CP-002',
      status: 'Offline',
      station: { id: 'st-102', name: 'Station B' },
    });
    prisma.ocpiPartnerLocation.findMany.mockResolvedValueOnce([]);

    const result = await service.findChargePointById('cp-2');

    expect(result).toEqual(
      expect.objectContaining({
        id: 'cp-2',
        roamingPublished: false,
      }),
    );
  });
});

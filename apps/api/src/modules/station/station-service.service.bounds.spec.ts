jest.mock('../../prisma.service', () => ({
  PrismaService: class PrismaServiceMock { }
}));

jest.mock('./provisioning/charger-provisioning.service', () => ({
  ChargerProvisioningService: class ChargerProvisioningServiceMock { }
}));

import { StationService } from './station-service.service';

describe('StationService bounds filtering', () => {
  const prisma = {
    station: {
      findMany: jest.fn()
    }
  };

  const provisioningService = {
    provision: jest.fn()
  };

  const service = new StationService(prisma as any, provisioningService as any);

  const stationEntity = {
    id: 'station-1',
    name: 'Demo Station',
    status: 'ACTIVE',
    latitude: 0.57,
    longitude: 32.64,
    address: 'Kampala',
    type: 'CHARGING',
    ownerId: null,
    operatorId: null,
    siteId: null,
    orgId: null,
    postalCode: null,
    zoneId: null,
    rating: 0,
    price: 0,
    amenities: '[]',
    images: '[]',
    open247: false,
    phone: null,
    bookingFee: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    chargePoints: [],
    site: null,
    zone: null,
    owner: null
  };

  beforeEach(() => {
    prisma.station.findMany.mockReset();
    prisma.station.findMany.mockResolvedValue([stationEntity]);
  });

  it('queries all stations when no bounds are provided', async () => {
    await service.findAllStations();

    expect(prisma.station.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: undefined
      })
    );
  });

  it('applies latitude and longitude bounds when provided', async () => {
    await service.findAllStations({
      north: 0.578,
      south: 0.561,
      east: 32.646,
      west: 32.637
    });

    expect(prisma.station.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          latitude: { gte: 0.561, lte: 0.578 },
          longitude: { gte: 32.637, lte: 32.646 }
        }
      })
    );
  });

  it('applies case-insensitive text search when q is provided', async () => {
    await service.findAllStations(undefined, 'kampala');

    expect(prisma.station.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { name: { contains: 'kampala', mode: 'insensitive' } },
            { address: { contains: 'kampala', mode: 'insensitive' } }
          ]
        }
      })
    );
  });

  it('combines bounds and text search when both are provided', async () => {
    await service.findAllStations(
      {
        north: 0.578,
        south: 0.561,
        east: 32.646,
        west: 32.637
      },
      'kampala'
    );

    expect(prisma.station.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          latitude: { gte: 0.561, lte: 0.578 },
          longitude: { gte: 32.637, lte: 32.646 },
          OR: [
            { name: { contains: 'kampala', mode: 'insensitive' } },
            { address: { contains: 'kampala', mode: 'insensitive' } }
          ]
        }
      })
    );
  });
});

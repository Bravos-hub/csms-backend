import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ZoneType } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { GeographyService } from './geography.service';

describe('GeographyService', () => {
  const prisma = {
    geographicZone: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    station: {
      findMany: jest.fn(),
    },
  };

  let service: GeographyService;
  const originalFetch = global.fetch;
  const originalIpApiKey = process.env.GEOGRAPHY_IPAPI_KEY;
  const originalOpenCageApiKey = process.env.GEOGRAPHY_OPENCAGE_API_KEY;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GEOGRAPHY_IPAPI_KEY = '';
    process.env.GEOGRAPHY_OPENCAGE_API_KEY = '';
    service = new GeographyService(prisma as unknown as PrismaService);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.GEOGRAPHY_IPAPI_KEY = originalIpApiKey;
    process.env.GEOGRAPHY_OPENCAGE_API_KEY = originalOpenCageApiKey;
  });

  it('creates a COUNTRY under a CONTINENT', async () => {
    prisma.geographicZone.findUnique.mockResolvedValueOnce({
      id: 'africa',
      type: ZoneType.CONTINENT,
      parentId: null,
    });
    prisma.geographicZone.create.mockResolvedValue({
      id: 'uganda',
      code: 'UG',
      type: ZoneType.COUNTRY,
    });

    await service.createZone({
      code: 'UG',
      name: 'Uganda',
      type: ZoneType.COUNTRY,
      parentId: 'africa',
    });

    expect(prisma.geographicZone.create).toHaveBeenCalled();
  });

  it('rejects an invalid parent-child type combination', async () => {
    prisma.geographicZone.findUnique.mockResolvedValueOnce({
      id: 'africa',
      type: ZoneType.CONTINENT,
      parentId: null,
    });

    await expect(
      service.createZone({
        code: 'KLA',
        name: 'Kampala',
        type: ZoneType.CITY,
        parentId: 'africa',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects missing parent zones', async () => {
    prisma.geographicZone.findUnique.mockResolvedValueOnce(null);

    await expect(
      service.createZone({
        code: 'UG',
        name: 'Uganda',
        type: ZoneType.COUNTRY,
        parentId: 'missing',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('blocks deactivation when active child zones exist', async () => {
    prisma.geographicZone.findUnique.mockResolvedValueOnce({
      id: 'uganda',
      type: ZoneType.COUNTRY,
    });
    prisma.geographicZone.count.mockResolvedValueOnce(1);

    await expect(service.setZoneStatus('uganda', false)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('detects location from ipapi provider', async () => {
    process.env.GEOGRAPHY_IPAPI_KEY = 'ipapi-key';
    service = new GeographyService(prisma as unknown as PrismaService);

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          country_code: 'US',
          country_name: 'United States',
          region_code: 'CA',
          region: 'California',
          city: 'San Francisco',
          postal: '94105',
          latitude: 37.7749,
          longitude: -122.4194,
        }),
    }) as unknown as typeof fetch;

    const result = await service.detectLocationFromIp('203.0.113.10');
    expect(result).toMatchObject({
      countryCode: 'US',
      countryName: 'United States',
      regionCode: 'US-CA',
      city: 'San Francisco',
    });
  });

  it('fails closed when ip geolocation provider key is missing', async () => {
    await expect(
      service.detectLocationFromIp('203.0.113.10'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('reverse geocodes coordinates with OpenCage provider', async () => {
    process.env.GEOGRAPHY_OPENCAGE_API_KEY = 'opencage-key';
    service = new GeographyService(prisma as unknown as PrismaService);

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          results: [
            {
              formatted: 'Kampala, Central Region, Uganda',
              components: {
                country_code: 'ug',
                country: 'Uganda',
                state: 'Central Region',
                city: 'Kampala',
                postcode: '256',
              },
            },
          ],
        }),
    }) as unknown as typeof fetch;

    const result = await service.reverseGeocode(0.3476, 32.5825);
    expect(result).toMatchObject({
      countryCode: 'UG',
      countryName: 'Uganda',
      adm1: 'Central Region',
      city: 'Kampala',
    });
  });

  it('rejects invalid reverse geocode coordinates', async () => {
    process.env.GEOGRAPHY_OPENCAGE_API_KEY = 'opencage-key';
    service = new GeographyService(prisma as unknown as PrismaService);

    await expect(
      service.reverseGeocode(Number.NaN, 32.58),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

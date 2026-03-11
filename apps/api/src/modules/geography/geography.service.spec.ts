import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ZoneType } from '@prisma/client';
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
  } as any;

  let service: GeographyService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new GeographyService(prisma);
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
});

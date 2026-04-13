import { ZoneType } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { PaymentMarketResolverService } from './payment-market-resolver.service';

describe('PaymentMarketResolverService', () => {
  const prisma = {
    user: {
      findUnique: jest.fn(),
    },
    geographicZone: {
      findUnique: jest.fn(),
    },
  };

  const service = new PaymentMarketResolverService(
    prisma as unknown as PrismaService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('routes user to CHINA when profile country is CN', async () => {
    prisma.user.findUnique.mockResolvedValue({
      zoneId: null,
      country: 'CN',
      region: null,
    });

    const result = await service.resolveForUser('user-1');

    expect(result.market).toBe('CHINA');
    expect(result.reason).toBe('user_profile:country');
  });

  it('routes guest to CHINA via geographic zone ancestry', async () => {
    prisma.geographicZone.findUnique
      .mockResolvedValueOnce({
        id: 'city-zone',
        code: 'GZ',
        name: 'Guangzhou',
        type: ZoneType.CITY,
        parentId: 'country-zone',
      })
      .mockResolvedValueOnce({
        id: 'country-zone',
        code: 'CN',
        name: 'China',
        type: ZoneType.COUNTRY,
        parentId: null,
      });

    const result = await service.resolveForGuest({
      zoneId: 'city-zone',
      country: null,
      region: null,
    });

    expect(result.market).toBe('CHINA');
    expect(result.reason).toBe('guest_payload:zone');
  });

  it('defaults to GLOBAL when geography is unknown', async () => {
    prisma.user.findUnique.mockResolvedValue({
      zoneId: null,
      country: null,
      region: null,
    });

    const result = await service.resolveForUser('user-2');

    expect(result.market).toBe('GLOBAL');
    expect(result.reason).toBe('user_profile:default_global');
  });
});

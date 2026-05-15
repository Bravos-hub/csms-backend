import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { BatteryProviderAccessService } from './battery-provider-access.service';
import { BatteryProviderContextService } from '@app/db';
import { PrismaService } from '../../prisma.service';

const mockPrisma = {
  batteryProviderUserScope: {
    findFirst: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
  },
} as unknown as PrismaService;

describe('BatteryProviderAccessService', () => {
  let service: BatteryProviderAccessService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BatteryProviderAccessService,
        BatteryProviderContextService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<BatteryProviderAccessService>(
      BatteryProviderAccessService,
    );
    jest.clearAllMocks();
  });

  describe('resolveProviderScope', () => {
    it('returns explicit user scope when found', async () => {
      (mockPrisma.batteryProviderUserScope.findFirst as jest.Mock).mockResolvedValue(
        {
          userId: 'u1',
          tenantId: 't1',
          providerId: 'p1',
          role: 'ADMIN',
          assignedStationIds: ['s1'],
          assignedCabinetIds: ['c1'],
        },
      );

      const scope = await service.resolveProviderScope('u1', 't1');
      expect(scope).toEqual({
        userId: 'u1',
        tenantId: 't1',
        providerId: 'p1',
        role: 'ADMIN',
        assignedStationIds: ['s1'],
        assignedCabinetIds: ['c1'],
      });
    });

    it('falls back to user.providerId when no explicit scope', async () => {
      (mockPrisma.batteryProviderUserScope.findFirst as jest.Mock).mockResolvedValue(null);
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        providerId: 'p1',
        role: 'SWAP_PROVIDER_ADMIN',
      });

      const scope = await service.resolveProviderScope('u1', 't1');
      expect(scope).toEqual({
        userId: 'u1',
        tenantId: 't1',
        providerId: 'p1',
        role: 'SWAP_PROVIDER_ADMIN',
        assignedStationIds: [],
        assignedCabinetIds: [],
      });
    });

    it('returns null when no provider scope exists', async () => {
      (mockPrisma.batteryProviderUserScope.findFirst as jest.Mock).mockResolvedValue(null);
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({ providerId: null });

      const scope = await service.resolveProviderScope('u1', 't1');
      expect(scope).toBeNull();
    });
  });

  describe('assertProviderScope', () => {
    it('throws when providerId mismatches', () => {
      expect(() =>
        service.assertProviderScope(
          { providerId: 'p1' } as any,
          'p2',
        ),
      ).toThrow(ForbiddenException);
    });

    it('does not throw when providerId matches', () => {
      expect(() =>
        service.assertProviderScope(
          { providerId: 'p1' } as any,
          'p1',
        ),
      ).not.toThrow();
    });
  });

  describe('assertStationAccess', () => {
    it('throws when station is not in assigned list', () => {
      expect(() =>
        service.assertStationAccess(
          { assignedStationIds: ['s1'] } as any,
          's2',
        ),
      ).toThrow(ForbiddenException);
    });

    it('allows access when assignedStationIds is empty', () => {
      expect(() =>
        service.assertStationAccess(
          { assignedStationIds: [] } as any,
          's2',
        ),
      ).not.toThrow();
    });
  });

  describe('buildProviderPackWhere', () => {
    it('includes providerId and tenant scope', () => {
      const where = service.buildProviderPackWhere({
        providerId: 'p1',
        tenantId: 't1',
        assignedStationIds: [],
        assignedCabinetIds: [],
      } as any);

      expect(where).toEqual({
        AND: [{ providerId: 'p1' }],
      });
    });

    it('adds station and cabinet constraints when assigned', () => {
      const where = service.buildProviderPackWhere({
        providerId: 'p1',
        tenantId: 't1',
        assignedStationIds: ['s1'],
        assignedCabinetIds: ['c1'],
      } as any);

      expect(where).toEqual({
        AND: [
          { providerId: 'p1' },
          {
            OR: [
              { stationId: { in: ['s1'] } },
              { stationId: null },
            ],
          },
          {
            OR: [
              { cabinetId: { in: ['c1'] } },
              { cabinetId: null },
            ],
          },
        ],
      });
    });
  });
});

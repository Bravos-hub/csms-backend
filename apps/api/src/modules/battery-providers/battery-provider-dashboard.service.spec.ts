import { Test, TestingModule } from '@nestjs/testing';
import { BatteryProviderDashboardService } from './battery-provider-dashboard.service';
import { BatteryProviderAccessService } from './battery-provider-access.service';
import { PrismaService } from '../../prisma.service';

const mockPrisma = {
  station: { count: jest.fn() },
  batteryCabinet: { count: jest.fn() },
  batteryPack: {
    aggregate: jest.fn(),
    count: jest.fn(),
  },
  batteryProviderAlert: { count: jest.fn() },
} as unknown as PrismaService;

const mockAccessService = {
  buildProviderStationWhere: jest.fn(() => ({ orgId: 't1' })),
  buildProviderCabinetWhere: jest.fn(() => ({
    tenantId: 't1',
    providerId: 'p1',
  })),
  buildProviderPackWhere: jest.fn(() => ({ providerId: 'p1' })),
  buildProviderAlertWhere: jest.fn(() => ({
    tenantId: 't1',
    providerId: 'p1',
  })),
} as unknown as BatteryProviderAccessService;

describe('BatteryProviderDashboardService', () => {
  let service: BatteryProviderDashboardService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BatteryProviderDashboardService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: BatteryProviderAccessService, useValue: mockAccessService },
      ],
    }).compile();

    service = module.get<BatteryProviderDashboardService>(
      BatteryProviderDashboardService,
    );
    jest.clearAllMocks();
  });

  describe('getOverview', () => {
    it('computes KPIs and readiness score', async () => {
      (mockPrisma.station.count as jest.Mock).mockResolvedValue(2);
      (mockPrisma.batteryCabinet.count as jest.Mock).mockResolvedValue(3);
      (mockPrisma.batteryPack.aggregate as jest.Mock).mockResolvedValue({
        _count: { id: 10 },
        _avg: { soc: 85, soh: 92 },
      });
      (mockPrisma.batteryProviderAlert.count as jest.Mock).mockResolvedValue(1);
      (mockPrisma.batteryPack.count as jest.Mock).mockResolvedValue(8);

      const result = await service.getOverview({
        userId: 'u1',
        tenantId: 't1',
        providerId: 'p1',
        role: 'ADMIN',
        assignedStationIds: [],
        assignedCabinetIds: [],
      });

      expect(result.assignedStations).toBe(2);
      expect(result.activeCabinets).toBe(3);
      expect(result.activePacks).toBe(10);
      expect(result.averageSoc).toBe(85);
      expect(result.averageSoh).toBe(92);
      expect(result.openCriticalAlerts).toBe(1);
      expect(result.swapReadinessScore).toBeGreaterThanOrEqual(0);
      expect(result.swapReadinessScore).toBeLessThanOrEqual(100);
    });

    it('returns 0 readiness when no assets', async () => {
      (mockPrisma.station.count as jest.Mock).mockResolvedValue(0);
      (mockPrisma.batteryCabinet.count as jest.Mock).mockResolvedValue(0);
      (mockPrisma.batteryPack.aggregate as jest.Mock).mockResolvedValue({
        _count: { id: 0 },
        _avg: { soc: null, soh: null },
      });
      (mockPrisma.batteryProviderAlert.count as jest.Mock).mockResolvedValue(0);
      (mockPrisma.batteryPack.count as jest.Mock).mockResolvedValue(0);

      const result = await service.getOverview({
        userId: 'u1',
        tenantId: 't1',
        providerId: 'p1',
        role: 'ADMIN',
        assignedStationIds: [],
        assignedCabinetIds: [],
      });

      expect(result.swapReadinessScore).toBe(0);
    });
  });
});

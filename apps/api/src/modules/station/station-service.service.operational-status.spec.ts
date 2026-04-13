/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-unsafe-argument */
import { StationService } from './station-service.service';
import { PrismaService } from '../../prisma.service';
import { ChargerProvisioningService } from './provisioning/charger-provisioning.service';
import { CommandsService } from '../commands/commands.service';

describe('StationService operational station status', () => {
  const prisma = {
    station: {
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
  const energyManagement = {
    recalculateStation: jest.fn(),
  };
  const tenantGuardrails = {
    requireTenantScope: jest
      .fn()
      .mockResolvedValue({ tenantId: 'tenant-1', cpoType: 'CHARGE' }),
    buildOwnedStationWhere: jest.fn((_: unknown, extra?: unknown) => extra),
    buildOwnedChargePointWhere: jest.fn((_: unknown, extra?: unknown) => extra),
    listOwnedStationIds: jest.fn().mockResolvedValue(['station-1']),
  };

  const service = new StationService(
    prisma as any,
    provisioningService as any,
    commands as any,
    ocpiService as any,
    energyManagement as any,
    tenantGuardrails as any,
  );

  const baseStation = {
    id: 'station-1',
    name: 'Demo Station',
    status: 'ACTIVE',
    type: 'CHARGING',
    latitude: 0.3,
    longitude: 32.5,
    address: 'Kampala',
    amenities: '[]',
    images: '[]',
    rating: 0,
    price: 0,
    open247: true,
    phone: null,
    bookingFee: 0,
    ownerId: null,
    orgId: null,
    site: null,
    owner: null,
    zone: null,
    chargePoints: [] as Array<{
      id: string;
      type: string;
      power: number;
      status?: string;
    }>,
  };

  const mapOperationalStatus = async (
    overrides: Partial<typeof baseStation>,
  ): Promise<string> => {
    prisma.station.findMany.mockResolvedValueOnce([
      {
        ...baseStation,
        ...overrides,
      },
    ]);

    const stations = await service.findAllStations();
    const first = stations[0] as { operationalStatus: string } | undefined;
    expect(first).toBeDefined();
    if (!first) {
      throw new Error('Expected a mapped station');
    }
    return first.operationalStatus;
  };

  beforeEach(() => {
    energyManagement.recalculateStation.mockReset();
    tenantGuardrails.requireTenantScope.mockReset();
    tenantGuardrails.requireTenantScope.mockResolvedValue({
      tenantId: 'tenant-1',
      cpoType: 'CHARGE',
    });
    tenantGuardrails.buildOwnedStationWhere.mockClear();
    tenantGuardrails.buildOwnedChargePointWhere.mockClear();
    tenantGuardrails.listOwnedStationIds.mockReset();
    tenantGuardrails.listOwnedStationIds.mockResolvedValue(['station-1']);
  });

  it('returns OFFLINE when all charge points are offline', async () => {
    const status = await mapOperationalStatus({
      chargePoints: [
        { id: 'cp-1', type: 'CCS2', power: 50, status: 'Offline' },
        { id: 'cp-2', type: 'CCS2', power: 50, status: 'Faulted' },
      ],
    });

    expect(status).toBe('OFFLINE');
  });

  it('returns DEGRADED when charge points are mixed offline and online', async () => {
    const status = await mapOperationalStatus({
      chargePoints: [
        { id: 'cp-1', type: 'CCS2', power: 50, status: 'Offline' },
        { id: 'cp-2', type: 'CCS2', power: 50, status: 'Available' },
      ],
    });

    expect(status).toBe('DEGRADED');
  });

  it('returns ONLINE when all charge points are operational non-offline states', async () => {
    const status = await mapOperationalStatus({
      chargePoints: [
        { id: 'cp-1', type: 'CCS2', power: 50, status: 'Charging' },
        { id: 'cp-2', type: 'CCS2', power: 50, status: 'Reserved' },
      ],
    });

    expect(status).toBe('ONLINE');
  });

  it('returns DEGRADED when no charge points exist on a charge-capable station', async () => {
    const status = await mapOperationalStatus({
      chargePoints: [],
    });

    expect(status).toBe('DEGRADED');
  });

  it('forces OFFLINE when lifecycle status is INACTIVE', async () => {
    const status = await mapOperationalStatus({
      status: 'INACTIVE',
      chargePoints: [
        { id: 'cp-1', type: 'CCS2', power: 50, status: 'Online' },
        { id: 'cp-2', type: 'CCS2', power: 50, status: 'Available' },
      ],
    });

    expect(status).toBe('OFFLINE');
  });

  it('forces MAINTENANCE when lifecycle status is MAINTENANCE', async () => {
    const status = await mapOperationalStatus({
      status: 'MAINTENANCE',
      chargePoints: [
        { id: 'cp-1', type: 'CCS2', power: 50, status: 'Online' },
        { id: 'cp-2', type: 'CCS2', power: 50, status: 'Available' },
      ],
    });

    expect(status).toBe('MAINTENANCE');
  });
});

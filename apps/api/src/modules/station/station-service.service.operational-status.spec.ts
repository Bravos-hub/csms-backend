import { StationService } from './station-service.service';

describe('StationService operational station status', () => {
  const prisma = {};
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
    chargePoints: [] as Array<{ status?: string }>,
  };

  const mapOperationalStatus = (overrides: Partial<typeof baseStation>) => {
    const mapped = (service as any).mapToFrontendStation({
      ...baseStation,
      ...overrides,
    });
    return mapped.operationalStatus;
  };

  it('returns OFFLINE when all charge points are offline', () => {
    const status = mapOperationalStatus({
      chargePoints: [{ status: 'Offline' }, { status: 'Faulted' }],
    });

    expect(status).toBe('OFFLINE');
  });

  it('returns DEGRADED when charge points are mixed offline and online', () => {
    const status = mapOperationalStatus({
      chargePoints: [{ status: 'Offline' }, { status: 'Available' }],
    });

    expect(status).toBe('DEGRADED');
  });

  it('returns ONLINE when all charge points are operational non-offline states', () => {
    const status = mapOperationalStatus({
      chargePoints: [{ status: 'Charging' }, { status: 'Reserved' }],
    });

    expect(status).toBe('ONLINE');
  });

  it('returns DEGRADED when no charge points exist on a charge-capable station', () => {
    const status = mapOperationalStatus({
      chargePoints: [],
    });

    expect(status).toBe('DEGRADED');
  });

  it('forces OFFLINE when lifecycle status is INACTIVE', () => {
    const status = mapOperationalStatus({
      status: 'INACTIVE',
      chargePoints: [{ status: 'Online' }, { status: 'Available' }],
    });

    expect(status).toBe('OFFLINE');
  });

  it('forces MAINTENANCE when lifecycle status is MAINTENANCE', () => {
    const status = mapOperationalStatus({
      status: 'MAINTENANCE',
      chargePoints: [{ status: 'Online' }, { status: 'Available' }],
    });

    expect(status).toBe('MAINTENANCE');
  });
});

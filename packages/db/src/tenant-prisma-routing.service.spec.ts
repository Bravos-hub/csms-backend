import { TenantPrismaRoutingService } from './tenant-prisma-routing.service';
import { TenantRoutingConfigService } from './tenant-routing-config.service';

describe('TenantPrismaRoutingService', () => {
  const originalEnv = { ...process.env };
  let service: TenantPrismaRoutingService | null = null;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      DATABASE_URL: 'postgresql://user:password@localhost:5432/evzone',
      TENANT_DEDICATED_DB_URLS_JSON: '{}',
      TENANT_CLIENT_CACHE_MAX: '20',
      NODE_ENV: 'test',
    };
  });

  afterEach(async () => {
    if (service) {
      await service.shutdown();
      service = null;
    }
    process.env = { ...originalEnv };
  });

  it('returns shared client when routing is absent', () => {
    service = new TenantPrismaRoutingService(new TenantRoutingConfigService());

    const shared = service.getSharedClient();
    const resolved = service.getClientForRouting(null);

    expect(resolved).toBe(shared);
  });

  it('reuses cached schema-tier clients by schema key', () => {
    service = new TenantPrismaRoutingService(new TenantRoutingConfigService());

    const first = service.getClientForRouting({
      organizationId: 'org-1',
      routingEnabled: true,
      tier: 'SCHEMA',
      schema: 'tenant_org_1',
    });

    const second = service.getClientForRouting({
      organizationId: 'org-1',
      routingEnabled: true,
      tier: 'SCHEMA',
      schema: 'tenant_org_1',
    });

    expect(second).toBe(first);
    expect(service.getRoutingMetrics().cachedClientCount).toBe(1);
  });

  it('throws when dedicated DB mapping is missing', () => {
    service = new TenantPrismaRoutingService(new TenantRoutingConfigService());

    expect(() =>
      service!.getClientForRouting({
        organizationId: 'org-missing',
        routingEnabled: true,
        tier: 'DEDICATED_DB',
      }),
    ).toThrow(/Missing dedicated database URL mapping/);
  });

  it('routes dedicated DB tenants using organization URL map and caches client', () => {
    process.env.TENANT_DEDICATED_DB_URLS_JSON =
      '{"org-dedicated":"postgresql://user:password@localhost:5432/evzone_dedicated"}';

    service = new TenantPrismaRoutingService(new TenantRoutingConfigService());

    const first = service.getClientForRouting({
      organizationId: 'org-dedicated',
      routingEnabled: true,
      tier: 'DEDICATED_DB',
    });

    const second = service.getClientForRouting({
      organizationId: 'org-dedicated',
      routingEnabled: true,
      tier: 'DEDICATED_DB',
    });

    expect(second).toBe(first);
    expect(service.getRoutingMetrics().cachedClientCount).toBe(1);
  });
});

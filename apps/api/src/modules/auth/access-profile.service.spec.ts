import { UserRole } from '@prisma/client';
import { AccessProfileService } from './access-profile.service';

describe('AccessProfileService', () => {
  const service = new AccessProfileService();

  it('maps platform super admin to platform scope with platform permissions', () => {
    const profile = service.buildProfile({
      activeOrganizationId: 'org-platform',
      effectiveRole: UserRole.SUPER_ADMIN,
      memberships: [],
      stationContexts: [],
      activeStationContext: null,
    });

    expect(profile.canonicalRole).toBe('PLATFORM_SUPER_ADMIN');
    expect(profile.roleFamily).toBe('platform');
    expect(profile.scope.type).toBe('platform');
    expect(profile.permissions).toContain('platform.tenants.write');
    expect(profile.permissions).toContain('tenant.users.write');
  });

  it('keeps platform scope tenant identifiers null when no impersonation tenant is selected', () => {
    const profile = service.buildProfile({
      activeOrganizationId: null,
      activeTenantId: null,
      effectiveRole: UserRole.SUPER_ADMIN,
      memberships: [],
      stationContexts: [],
      activeStationContext: null,
    });

    expect(profile.scope.type).toBe('platform');
    expect(profile.scope.organizationId).toBeNull();
    expect(profile.scope.tenantId).toBeNull();
  });

  it('maps station manager style roles to station scope when an active assignment exists', () => {
    const profile = service.buildProfile({
      activeOrganizationId: 'org-1',
      effectiveRole: UserRole.MANAGER,
      memberships: [
        {
          organizationId: 'org-1',
          role: UserRole.MANAGER,
        },
      ],
      stationContexts: [
        {
          assignmentId: 'assign-1',
          stationId: 'station-1',
          stationName: 'Station One',
          organizationId: 'org-1',
          role: UserRole.MANAGER,
          isPrimary: true,
        },
      ],
      activeStationContext: {
        assignmentId: 'assign-1',
        stationId: 'station-1',
        stationName: 'Station One',
        organizationId: 'org-1',
        role: UserRole.MANAGER,
        isPrimary: true,
      },
    });

    expect(profile.canonicalRole).toBe('STATION_MANAGER');
    expect(profile.scope.type).toBe('station');
    expect(profile.scope.stationId).toBe('station-1');
    expect(profile.scope.stationIds).toEqual(['station-1']);
    expect(profile.permissions).toContain('charge_points.command');
  });

  it('maps tenant admin style roles to organization scope without station assignments', () => {
    const profile = service.buildProfile({
      activeOrganizationId: 'org-tenant',
      effectiveRole: UserRole.STATION_ADMIN,
      memberships: [
        {
          organizationId: 'org-tenant',
          role: UserRole.STATION_ADMIN,
        },
      ],
      stationContexts: [],
      activeStationContext: null,
    });

    expect(profile.canonicalRole).toBe('TENANT_ADMIN');
    expect(profile.scope.type).toBe('tenant');
    expect(profile.scope.organizationId).toBe('org-tenant');
    expect(profile.permissions).toContain('tenant.users.write');
    expect(profile.permissions).toContain('tenant.tariffs.write');
  });

  it('maps provider users to provider scope with roaming-facing permissions', () => {
    const profile = service.buildProfile({
      activeOrganizationId: null,
      effectiveRole: UserRole.SWAP_PROVIDER_ADMIN,
      memberships: [],
      stationContexts: [],
      activeStationContext: null,
      providerId: 'provider-1',
    });

    expect(profile.canonicalRole).toBe('ROAMING_MANAGER');
    expect(profile.scope.type).toBe('provider');
    expect(profile.scope.providerId).toBe('provider-1');
    expect(profile.permissions).toContain('ocpi.partners.write');
  });

  it('maps drivers to fleet-group scope with restricted driver permissions', () => {
    const profile = service.buildProfile({
      activeOrganizationId: 'fleet-org',
      effectiveRole: UserRole.DRIVER,
      memberships: [],
      stationContexts: [],
      activeStationContext: null,
    });

    expect(profile.canonicalRole).toBe('FLEET_DRIVER');
    expect(profile.scope.type).toBe('fleet_group');
    expect(profile.permissions).toEqual([
      'fleet.driver.session.start',
      'fleet.driver.session.stop',
      'fleet.vehicles.read',
    ]);
  });
});

import { Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';

export type CanonicalAccessRole =
  | 'PLATFORM_SUPER_ADMIN'
  | 'PLATFORM_BILLING_ADMIN'
  | 'PLATFORM_NOC_LEAD'
  | 'TENANT_ADMIN'
  | 'SITE_HOST'
  | 'ROAMING_MANAGER'
  | 'STATION_MANAGER'
  | 'OPERATIONS_OPERATOR'
  | 'TENANT_FINANCE_ANALYST'
  | 'FLEET_DISPATCHER'
  | 'FLEET_DRIVER'
  | 'INSTALLER_AGENT'
  | 'SMART_CHARGING_ENGINEER'
  | 'FIELD_TECHNICIAN'
  | 'EXTERNAL_PROVIDER_ADMIN'
  | 'EXTERNAL_PROVIDER_OPERATOR'
  | 'LEGACY_UNMAPPED';

export type AccessScopeType =
  | 'platform'
  | 'organization'
  | 'site'
  | 'station'
  | 'fleet_group'
  | 'charge_point'
  | 'device'
  | 'temporary'
  | 'provider';

export type AccessRoleFamily =
  | 'platform'
  | 'tenant'
  | 'operations'
  | 'finance'
  | 'fleet'
  | 'technical'
  | 'provider'
  | 'legacy';

export interface AccessScopeSummary {
  type: AccessScopeType;
  organizationId: string | null;
  stationId: string | null;
  stationIds: string[];
  providerId: string | null;
  isTemporary: boolean;
}

export interface AccessProfile {
  version: '2026-04-v1';
  legacyRole: UserRole;
  canonicalRole: CanonicalAccessRole;
  roleFamily: AccessRoleFamily;
  permissions: string[];
  scope: AccessScopeSummary;
}

export interface AccessMembershipSummary {
  organizationId: string;
  role: UserRole;
  organizationName?: string;
  organizationType?: string;
}

export interface AccessStationContextSummary {
  assignmentId: string;
  stationId: string;
  stationName: string | null;
  organizationId: string | null;
  role: UserRole;
  isPrimary: boolean;
}

export interface AccessProfileInput {
  activeOrganizationId: string | null;
  effectiveRole: UserRole;
  memberships: AccessMembershipSummary[];
  stationContexts: AccessStationContextSummary[];
  activeStationContext: AccessStationContextSummary | null;
  providerId?: string | null;
}

const PLATFORM_PERMISSIONS = [
  'platform.tenants.read',
  'platform.tenants.write',
  'platform.billing.read',
  'platform.billing.write',
  'platform.health.read',
  'platform.integrations.read',
  'platform.integrations.write',
  'platform.audit.read',
];

const TENANT_ADMIN_PERMISSIONS = [
  'tenant.users.read',
  'tenant.users.write',
  'tenant.branding.read',
  'tenant.branding.write',
  'tenant.settings.read',
  'tenant.settings.write',
  'tenant.tariffs.read',
  'tenant.tariffs.write',
  'sites.read',
  'sites.write',
  'stations.read',
  'stations.write',
  'charge_points.read',
  'charge_points.write',
  'charge_points.command',
  'charge_points.security.write',
  'sessions.read',
  'sessions.write',
  'incidents.read',
  'incidents.write',
  'alerts.read',
  'commands.read',
  'commands.write',
  'smart_charging.read',
  'smart_charging.write',
  'load_profiles.read',
  'load_profiles.write',
  'battery_inventory.read',
  'battery_inventory.write',
  'ocpi.partners.read',
  'ocpi.partners.write',
  'ocpi.sessions.read',
  'ocpi.cdrs.read',
  'ocpi.commands.read',
  'ocpi.commands.write',
  'finance.billing.read',
  'finance.payouts.read',
  'finance.settlement.read',
  'finance.revenue_reports.read',
];

const NOC_PERMISSIONS = [
  'platform.health.read',
  'platform.audit.read',
  'stations.read',
  'charge_points.read',
  'sessions.read',
  'incidents.read',
  'alerts.read',
  'commands.read',
  'charge_points.command',
  'maintenance.dispatch.read',
  'maintenance.dispatch.write',
  'maintenance.diagnostics.read',
];

const SITE_HOST_PERMISSIONS = [
  'sites.read',
  'stations.read',
  'charge_points.read',
  'sessions.read',
  'finance.revenue_reports.read',
  'incidents.read',
  'alerts.read',
];

const STATION_MANAGER_PERMISSIONS = [
  'sites.read',
  'stations.read',
  'stations.write',
  'charge_points.read',
  'charge_points.write',
  'charge_points.command',
  'sessions.read',
  'incidents.read',
  'incidents.write',
  'alerts.read',
  'commands.read',
  'commands.write',
  'smart_charging.read',
  'load_profiles.read',
  'maintenance.dispatch.read',
  'maintenance.dispatch.write',
  'maintenance.diagnostics.read',
];

const OPERATIONS_OPERATOR_PERMISSIONS = [
  'stations.read',
  'charge_points.read',
  'charge_points.command',
  'sessions.read',
  'incidents.read',
  'incidents.write',
  'alerts.read',
  'commands.read',
  'commands.write',
];

const TECHNICIAN_PERMISSIONS = [
  'stations.read',
  'charge_points.read',
  'incidents.read',
  'maintenance.dispatch.read',
  'maintenance.dispatch.write',
  'maintenance.diagnostics.read',
  'charge_points.command',
];

const PROVIDER_PERMISSIONS = [
  'ocpi.partners.read',
  'ocpi.partners.write',
  'ocpi.sessions.read',
  'ocpi.cdrs.read',
  'ocpi.commands.read',
];

const DRIVER_PERMISSIONS = [
  'fleet.driver.session.start',
  'fleet.driver.session.stop',
  'fleet.vehicles.read',
];

const ROLE_MAPPING: Record<
  UserRole,
  {
    canonicalRole: CanonicalAccessRole;
    roleFamily: AccessRoleFamily;
    permissions: string[];
  }
> = {
  SUPER_ADMIN: {
    canonicalRole: 'PLATFORM_SUPER_ADMIN',
    roleFamily: 'platform',
    permissions: [...PLATFORM_PERMISSIONS, ...TENANT_ADMIN_PERMISSIONS],
  },
  EVZONE_ADMIN: {
    canonicalRole: 'PLATFORM_SUPER_ADMIN',
    roleFamily: 'platform',
    permissions: [...PLATFORM_PERMISSIONS, ...TENANT_ADMIN_PERMISSIONS],
  },
  EVZONE_OPERATOR: {
    canonicalRole: 'PLATFORM_NOC_LEAD',
    roleFamily: 'platform',
    permissions: NOC_PERMISSIONS,
  },
  SWAP_PROVIDER_ADMIN: {
    canonicalRole: 'EXTERNAL_PROVIDER_ADMIN',
    roleFamily: 'provider',
    permissions: PROVIDER_PERMISSIONS,
  },
  SWAP_PROVIDER_OPERATOR: {
    canonicalRole: 'EXTERNAL_PROVIDER_OPERATOR',
    roleFamily: 'provider',
    permissions: PROVIDER_PERMISSIONS,
  },
  SITE_OWNER: {
    canonicalRole: 'SITE_HOST',
    roleFamily: 'tenant',
    permissions: SITE_HOST_PERMISSIONS,
  },
  STATION_OWNER: {
    canonicalRole: 'TENANT_ADMIN',
    roleFamily: 'tenant',
    permissions: TENANT_ADMIN_PERMISSIONS,
  },
  OWNER: {
    canonicalRole: 'SITE_HOST',
    roleFamily: 'tenant',
    permissions: SITE_HOST_PERMISSIONS,
  },
  STATION_OPERATOR: {
    canonicalRole: 'OPERATIONS_OPERATOR',
    roleFamily: 'operations',
    permissions: OPERATIONS_OPERATOR_PERMISSIONS,
  },
  STATION_ADMIN: {
    canonicalRole: 'TENANT_ADMIN',
    roleFamily: 'tenant',
    permissions: TENANT_ADMIN_PERMISSIONS,
  },
  MANAGER: {
    canonicalRole: 'STATION_MANAGER',
    roleFamily: 'operations',
    permissions: STATION_MANAGER_PERMISSIONS,
  },
  ATTENDANT: {
    canonicalRole: 'OPERATIONS_OPERATOR',
    roleFamily: 'operations',
    permissions: OPERATIONS_OPERATOR_PERMISSIONS,
  },
  CASHIER: {
    canonicalRole: 'OPERATIONS_OPERATOR',
    roleFamily: 'operations',
    permissions: OPERATIONS_OPERATOR_PERMISSIONS,
  },
  TECHNICIAN_ORG: {
    canonicalRole: 'FIELD_TECHNICIAN',
    roleFamily: 'technical',
    permissions: TECHNICIAN_PERMISSIONS,
  },
  TECHNICIAN_PUBLIC: {
    canonicalRole: 'FIELD_TECHNICIAN',
    roleFamily: 'technical',
    permissions: TECHNICIAN_PERMISSIONS,
  },
  DRIVER: {
    canonicalRole: 'FLEET_DRIVER',
    roleFamily: 'fleet',
    permissions: DRIVER_PERMISSIONS,
  },
};

@Injectable()
export class AccessProfileService {
  buildProfile(input: AccessProfileInput): AccessProfile {
    const mapping =
      ROLE_MAPPING[input.effectiveRole] ||
      ({
        canonicalRole: 'LEGACY_UNMAPPED',
        roleFamily: 'legacy',
        permissions: [],
      } as const);

    const stationIds = Array.from(
      new Set(input.stationContexts.map((context) => context.stationId)),
    );

    return {
      version: '2026-04-v1',
      legacyRole: input.effectiveRole,
      canonicalRole: mapping.canonicalRole,
      roleFamily: mapping.roleFamily,
      permissions: Array.from(new Set(mapping.permissions)).sort(),
      scope: this.resolveScope(input, stationIds),
    };
  }

  private resolveScope(
    input: AccessProfileInput,
    stationIds: string[],
  ): AccessScopeSummary {
    if (
      input.effectiveRole === UserRole.SUPER_ADMIN ||
      input.effectiveRole === UserRole.EVZONE_ADMIN ||
      input.effectiveRole === UserRole.EVZONE_OPERATOR
    ) {
      return {
        type: 'platform',
        organizationId: input.activeOrganizationId,
        stationId: null,
        stationIds,
        providerId: input.providerId || null,
        isTemporary: false,
      };
    }

    if (
      input.effectiveRole === UserRole.SWAP_PROVIDER_ADMIN ||
      input.effectiveRole === UserRole.SWAP_PROVIDER_OPERATOR
    ) {
      return {
        type: 'provider',
        organizationId: input.activeOrganizationId,
        stationId: null,
        stationIds,
        providerId: input.providerId || null,
        isTemporary: false,
      };
    }

    if (input.effectiveRole === UserRole.DRIVER) {
      return {
        type: 'fleet_group',
        organizationId: input.activeOrganizationId,
        stationId: null,
        stationIds,
        providerId: input.providerId || null,
        isTemporary: false,
      };
    }

    if (input.activeStationContext) {
      return {
        type: 'station',
        organizationId:
          input.activeStationContext.organizationId || input.activeOrganizationId,
        stationId: input.activeStationContext.stationId,
        stationIds,
        providerId: input.providerId || null,
        isTemporary: false,
      };
    }

    return {
      type: 'organization',
      organizationId: input.activeOrganizationId,
      stationId: null,
      stationIds,
      providerId: input.providerId || null,
      isTemporary: false,
    };
  }
}

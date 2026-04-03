export const LEGACY_ROLE_KEYS = [
  'SUPER_ADMIN',
  'EVZONE_ADMIN',
  'EVZONE_OPERATOR',
  'SWAP_PROVIDER_ADMIN',
  'SWAP_PROVIDER_OPERATOR',
  'SITE_OWNER',
  'STATION_OWNER',
  'OWNER',
  'STATION_OPERATOR',
  'STATION_ADMIN',
  'MANAGER',
  'ATTENDANT',
  'CASHIER',
  'TECHNICIAN_ORG',
  'TECHNICIAN_PUBLIC',
  'DRIVER',
] as const;

export type LegacyRoleKey = (typeof LEGACY_ROLE_KEYS)[number];

export const CANONICAL_ROLE_KEYS = [
  'PLATFORM_SUPER_ADMIN',
  'PLATFORM_BILLING_ADMIN',
  'PLATFORM_NOC_LEAD',
  'TENANT_ADMIN',
  'STATION_MANAGER',
  'SITE_HOST',
  'ROAMING_MANAGER',
  'FLEET_DISPATCHER',
  'FLEET_DRIVER',
  'INSTALLER_AGENT',
  'SMART_CHARGING_ENGINEER',
  'OPERATIONS_OPERATOR',
  'FIELD_TECHNICIAN',
  'TENANT_FINANCE_ANALYST',
  'EXTERNAL_PROVIDER_OPERATOR',
] as const;

export type CanonicalRoleKey = (typeof CANONICAL_ROLE_KEYS)[number];
export type SupportedRoleKey = LegacyRoleKey | CanonicalRoleKey;

export type AccessScopeType =
  | 'platform'
  | 'tenant'
  | 'site'
  | 'station'
  | 'fleet_group'
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
  | 'provider';

export type PermissionScope = 'PLATFORM' | 'TENANT';

export interface CanonicalRoleDefinition {
  key: CanonicalRoleKey;
  label: string;
  description: string;
  family: AccessRoleFamily;
  scopeType: AccessScopeType;
  permissionScope: PermissionScope;
  customizable: boolean;
  defaultLegacyRole: LegacyRoleKey;
  permissions: readonly string[];
}

const PLATFORM_BILLING_PERMISSIONS = [
  'platform.billing.read',
  'platform.billing.write',
  'platform.subscriptions.read',
  'platform.subscriptions.write',
  'platform.tenants.read',
  'platform.tenants.write',
  'platform.audit.read',
] as const;

const PLATFORM_NOC_PERMISSIONS = [
  'platform.health.read',
  'platform.audit.read',
  'platform.ocpp_logs.read',
  'platform.integrations.read',
  'stations.read',
  'charge_points.read',
  'charge_points.command',
  'sessions.read',
  'incidents.read',
  'incidents.write',
  'alerts.read',
  'maintenance.dispatch.read',
  'maintenance.dispatch.write',
  'maintenance.diagnostics.read',
] as const;

const TENANT_ADMIN_PERMISSIONS = [
  'tenant.users.read',
  'tenant.users.write',
  'tenant.memberships.read',
  'tenant.memberships.write',
  'tenant.roles.read',
  'tenant.roles.write',
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
  'documents.read',
  'documents.write',
] as const;

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
  'maintenance.dispatch.read',
  'maintenance.dispatch.write',
  'maintenance.diagnostics.read',
  'smart_charging.read',
  'load_profiles.read',
] as const;

const SITE_HOST_PERMISSIONS = [
  'sites.read',
  'stations.read',
  'charge_points.read',
  'sessions.read',
  'finance.revenue_reports.read',
  'incidents.read',
  'alerts.read',
] as const;

const ROAMING_MANAGER_PERMISSIONS = [
  'ocpi.partners.read',
  'ocpi.partners.write',
  'ocpi.sessions.read',
  'ocpi.cdrs.read',
  'ocpi.commands.read',
  'ocpi.commands.write',
] as const;

const FLEET_DISPATCHER_PERMISSIONS = [
  'fleet.vehicles.read',
  'fleet.vehicles.write',
  'fleet.groups.read',
  'fleet.groups.write',
  'fleet.dispatch.read',
  'fleet.dispatch.write',
  'sessions.read',
  'stations.read',
  'charge_points.read',
  'finance.reports.read',
] as const;

const FLEET_DRIVER_PERMISSIONS = [
  'fleet.driver.session.start',
  'fleet.driver.session.stop',
  'fleet.vehicles.read',
] as const;

const INSTALLER_AGENT_PERMISSIONS = [
  'stations.read',
  'charge_points.read',
  'charge_points.write',
  'devices.commission',
  'devices.handshake.write',
  'devices.tests.write',
] as const;

const SMART_CHARGING_ENGINEER_PERMISSIONS = [
  'sites.read',
  'stations.read',
  'charge_points.read',
  'smart_charging.read',
  'smart_charging.write',
  'load_profiles.read',
  'load_profiles.write',
  'commands.read',
] as const;

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
] as const;

const FIELD_TECHNICIAN_PERMISSIONS = [
  'stations.read',
  'charge_points.read',
  'incidents.read',
  'maintenance.dispatch.read',
  'maintenance.dispatch.write',
  'maintenance.diagnostics.read',
  'charge_points.command',
] as const;

const EXTERNAL_PROVIDER_OPERATOR_PERMISSIONS = [
  'ocpi.partners.read',
  'ocpi.sessions.read',
  'ocpi.cdrs.read',
  'ocpi.commands.read',
  'ocpi.commands.write',
] as const;

const TENANT_FINANCE_ANALYST_PERMISSIONS = [
  'finance.billing.read',
  'finance.payouts.read',
  'finance.settlement.read',
  'finance.revenue_reports.read',
  'tenant.tariffs.read',
  'sites.read',
  'stations.read',
  'sessions.read',
] as const;

const dedupe = (...groups: readonly (readonly string[])[]): string[] =>
  Array.from(new Set(groups.flat())).sort();

export const CANONICAL_ROLE_DEFINITIONS: Record<
  CanonicalRoleKey,
  CanonicalRoleDefinition
> = {
  PLATFORM_SUPER_ADMIN: {
    key: 'PLATFORM_SUPER_ADMIN',
    label: 'Platform Super-Admin',
    description:
      'Global provider administrator with full platform and tenant access.',
    family: 'platform',
    scopeType: 'platform',
    permissionScope: 'PLATFORM',
    customizable: false,
    defaultLegacyRole: 'SUPER_ADMIN',
    permissions: dedupe(
      PLATFORM_BILLING_PERMISSIONS,
      PLATFORM_NOC_PERMISSIONS,
      TENANT_ADMIN_PERMISSIONS,
      STATION_MANAGER_PERMISSIONS,
      SITE_HOST_PERMISSIONS,
      ROAMING_MANAGER_PERMISSIONS,
      FLEET_DISPATCHER_PERMISSIONS,
      FLEET_DRIVER_PERMISSIONS,
      INSTALLER_AGENT_PERMISSIONS,
      SMART_CHARGING_ENGINEER_PERMISSIONS,
      OPERATIONS_OPERATOR_PERMISSIONS,
      FIELD_TECHNICIAN_PERMISSIONS,
      EXTERNAL_PROVIDER_OPERATOR_PERMISSIONS,
      ['platform.api_keys.read', 'platform.api_keys.write'],
    ),
  },
  PLATFORM_BILLING_ADMIN: {
    key: 'PLATFORM_BILLING_ADMIN',
    label: 'Platform Billing Admin',
    description:
      'Global finance operator responsible for tenant subscriptions and billing.',
    family: 'platform',
    scopeType: 'platform',
    permissionScope: 'PLATFORM',
    customizable: false,
    defaultLegacyRole: 'OWNER',
    permissions: dedupe(PLATFORM_BILLING_PERMISSIONS),
  },
  PLATFORM_NOC_LEAD: {
    key: 'PLATFORM_NOC_LEAD',
    label: 'Network Operations Center Lead',
    description:
      'Global technical operator for platform health and cross-tenant charger oversight.',
    family: 'platform',
    scopeType: 'platform',
    permissionScope: 'PLATFORM',
    customizable: false,
    defaultLegacyRole: 'EVZONE_OPERATOR',
    permissions: dedupe(PLATFORM_NOC_PERMISSIONS),
  },
  TENANT_ADMIN: {
    key: 'TENANT_ADMIN',
    label: 'Tenant Admin',
    description:
      'Full control of a tenant workspace, excluding platform-wide administration.',
    family: 'tenant',
    scopeType: 'tenant',
    permissionScope: 'TENANT',
    customizable: true,
    defaultLegacyRole: 'STATION_ADMIN',
    permissions: dedupe(TENANT_ADMIN_PERMISSIONS),
  },
  STATION_MANAGER: {
    key: 'STATION_MANAGER',
    label: 'Station Manager',
    description:
      'Operational manager for one or more stations within a tenant.',
    family: 'operations',
    scopeType: 'station',
    permissionScope: 'TENANT',
    customizable: true,
    defaultLegacyRole: 'MANAGER',
    permissions: dedupe(STATION_MANAGER_PERMISSIONS),
  },
  SITE_HOST: {
    key: 'SITE_HOST',
    label: 'Site Host',
    description:
      'Read-only business stakeholder for site energy and revenue visibility.',
    family: 'tenant',
    scopeType: 'site',
    permissionScope: 'TENANT',
    customizable: true,
    defaultLegacyRole: 'SITE_OWNER',
    permissions: dedupe(SITE_HOST_PERMISSIONS),
  },
  ROAMING_MANAGER: {
    key: 'ROAMING_MANAGER',
    label: 'Roaming Manager',
    description:
      'Tenant role for external roaming agreements and OCPI operations.',
    family: 'provider',
    scopeType: 'provider',
    permissionScope: 'TENANT',
    customizable: true,
    defaultLegacyRole: 'SWAP_PROVIDER_ADMIN',
    permissions: dedupe(ROAMING_MANAGER_PERMISSIONS),
  },
  FLEET_DISPATCHER: {
    key: 'FLEET_DISPATCHER',
    label: 'Fleet Dispatcher',
    description:
      'Sub-tenant fleet operator responsible for vehicle readiness and dispatch.',
    family: 'fleet',
    scopeType: 'fleet_group',
    permissionScope: 'TENANT',
    customizable: true,
    defaultLegacyRole: 'OWNER',
    permissions: dedupe(FLEET_DISPATCHER_PERMISSIONS),
  },
  FLEET_DRIVER: {
    key: 'FLEET_DRIVER',
    label: 'Fleet Driver',
    description:
      'Restricted mobile role for starting and stopping authorized fleet sessions.',
    family: 'fleet',
    scopeType: 'fleet_group',
    permissionScope: 'TENANT',
    customizable: true,
    defaultLegacyRole: 'DRIVER',
    permissions: dedupe(FLEET_DRIVER_PERMISSIONS),
  },
  INSTALLER_AGENT: {
    key: 'INSTALLER_AGENT',
    label: 'Installer / Commissioning Agent',
    description:
      'Temporary role for charger onboarding, pairing, and commissioning.',
    family: 'technical',
    scopeType: 'temporary',
    permissionScope: 'TENANT',
    customizable: true,
    defaultLegacyRole: 'TECHNICIAN_PUBLIC',
    permissions: dedupe(INSTALLER_AGENT_PERMISSIONS),
  },
  SMART_CHARGING_ENGINEER: {
    key: 'SMART_CHARGING_ENGINEER',
    label: 'Smart Charging Engineer',
    description:
      'Technical role for load profiles and smart charging coordination.',
    family: 'technical',
    scopeType: 'site',
    permissionScope: 'TENANT',
    customizable: true,
    defaultLegacyRole: 'TECHNICIAN_ORG',
    permissions: dedupe(SMART_CHARGING_ENGINEER_PERMISSIONS),
  },
  OPERATIONS_OPERATOR: {
    key: 'OPERATIONS_OPERATOR',
    label: 'Operations Operator',
    description:
      'Day-to-day tenant operations role for charger commands and incident handling.',
    family: 'operations',
    scopeType: 'station',
    permissionScope: 'TENANT',
    customizable: true,
    defaultLegacyRole: 'STATION_OPERATOR',
    permissions: dedupe(OPERATIONS_OPERATOR_PERMISSIONS),
  },
  FIELD_TECHNICIAN: {
    key: 'FIELD_TECHNICIAN',
    label: 'Field Technician',
    description:
      'Field support role for diagnostics, maintenance dispatch, and device recovery.',
    family: 'technical',
    scopeType: 'device',
    permissionScope: 'TENANT',
    customizable: true,
    defaultLegacyRole: 'TECHNICIAN_ORG',
    permissions: dedupe(FIELD_TECHNICIAN_PERMISSIONS),
  },
  TENANT_FINANCE_ANALYST: {
    key: 'TENANT_FINANCE_ANALYST',
    label: 'Tenant Finance Analyst',
    description:
      'Tenant-level financial operator for revenue, settlements, and billing visibility.',
    family: 'finance',
    scopeType: 'tenant',
    permissionScope: 'TENANT',
    customizable: true,
    defaultLegacyRole: 'OWNER',
    permissions: dedupe(TENANT_FINANCE_ANALYST_PERMISSIONS),
  },
  EXTERNAL_PROVIDER_OPERATOR: {
    key: 'EXTERNAL_PROVIDER_OPERATOR',
    label: 'External Provider Operator',
    description:
      'External network operator with constrained roaming and session visibility.',
    family: 'provider',
    scopeType: 'provider',
    permissionScope: 'TENANT',
    customizable: true,
    defaultLegacyRole: 'SWAP_PROVIDER_OPERATOR',
    permissions: dedupe(EXTERNAL_PROVIDER_OPERATOR_PERMISSIONS),
  },
};

export const LEGACY_ROLE_TO_CANONICAL_ROLE: Record<
  LegacyRoleKey,
  CanonicalRoleKey
> = {
  SUPER_ADMIN: 'PLATFORM_SUPER_ADMIN',
  EVZONE_ADMIN: 'PLATFORM_SUPER_ADMIN',
  EVZONE_OPERATOR: 'PLATFORM_NOC_LEAD',
  SWAP_PROVIDER_ADMIN: 'ROAMING_MANAGER',
  SWAP_PROVIDER_OPERATOR: 'EXTERNAL_PROVIDER_OPERATOR',
  SITE_OWNER: 'SITE_HOST',
  STATION_OWNER: 'TENANT_ADMIN',
  OWNER: 'SITE_HOST',
  STATION_OPERATOR: 'OPERATIONS_OPERATOR',
  STATION_ADMIN: 'TENANT_ADMIN',
  MANAGER: 'STATION_MANAGER',
  ATTENDANT: 'OPERATIONS_OPERATOR',
  CASHIER: 'OPERATIONS_OPERATOR',
  TECHNICIAN_ORG: 'FIELD_TECHNICIAN',
  TECHNICIAN_PUBLIC: 'FIELD_TECHNICIAN',
  DRIVER: 'FLEET_DRIVER',
};

export const CANONICAL_ROLE_TO_STORAGE_ROLE: Record<
  CanonicalRoleKey,
  LegacyRoleKey
> = Object.fromEntries(
  CANONICAL_ROLE_KEYS.map((roleKey) => [
    roleKey,
    CANONICAL_ROLE_DEFINITIONS[roleKey].defaultLegacyRole,
  ]),
) as Record<CanonicalRoleKey, LegacyRoleKey>;

export const ALL_PERMISSION_CODES = Array.from(
  new Set(
    CANONICAL_ROLE_KEYS.flatMap(
      (roleKey) => CANONICAL_ROLE_DEFINITIONS[roleKey].permissions,
    ),
  ),
).sort();

export const TENANT_SCOPED_PERMISSION_CODES = ALL_PERMISSION_CODES.filter(
  (permission) => !permission.startsWith('platform.'),
);

export function isCanonicalRoleKey(value: string): value is CanonicalRoleKey {
  return CANONICAL_ROLE_KEYS.includes(value as CanonicalRoleKey);
}

export function isLegacyRoleKey(value: string): value is LegacyRoleKey {
  return LEGACY_ROLE_KEYS.includes(value as LegacyRoleKey);
}

export function resolveCanonicalRoleKey(role: string): CanonicalRoleKey | null {
  if (isCanonicalRoleKey(role)) {
    return role;
  }

  if (isLegacyRoleKey(role)) {
    return LEGACY_ROLE_TO_CANONICAL_ROLE[role];
  }

  return null;
}

export function resolveStorageRole(role: string): LegacyRoleKey | null {
  if (isLegacyRoleKey(role)) {
    return role;
  }

  if (isCanonicalRoleKey(role)) {
    return CANONICAL_ROLE_TO_STORAGE_ROLE[role];
  }

  return null;
}

export function getCanonicalRoleDefinition(
  role: string,
): CanonicalRoleDefinition | null {
  const canonicalRole = resolveCanonicalRoleKey(role);
  return canonicalRole ? CANONICAL_ROLE_DEFINITIONS[canonicalRole] : null;
}

export function resolveRoleLabel(role: string): string {
  return getCanonicalRoleDefinition(role)?.label || role;
}

export function isTenantScopedPermission(permissionCode: string): boolean {
  return !permissionCode.startsWith('platform.');
}

export function canCustomizeCanonicalRole(role: string): boolean {
  return Boolean(getCanonicalRoleDefinition(role)?.customizable);
}

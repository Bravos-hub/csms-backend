import { Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import {
  CANONICAL_ROLE_DEFINITIONS,
  getCanonicalRoleDefinition,
  isTenantScopedPermission,
  resolveCanonicalRoleKey,
  resolveRoleLabel,
  type AccessRoleFamily,
  type AccessScopeType,
  type CanonicalRoleKey,
  type PermissionScope,
} from '@app/domain';

export type CanonicalAccessRole = CanonicalRoleKey;

export interface AccessScopeSummary {
  type: AccessScopeType;
  organizationId: string | null;
  tenantId: string | null;
  stationId: string | null;
  stationIds: string[];
  providerId: string | null;
  isTemporary: boolean;
}

export interface AccessProfile {
  version: '2026-04-v2';
  legacyRole: UserRole;
  canonicalRole: CanonicalAccessRole;
  canonicalRoleLabel: string;
  baseRoleKey: CanonicalRoleKey;
  roleFamily: AccessRoleFamily;
  permissionScope: PermissionScope;
  permissions: string[];
  scope: AccessScopeSummary;
  isCustomRole: boolean;
  customRoleId: string | null;
  customRoleName: string | null;
}

export interface AccessMembershipSummary {
  id?: string;
  organizationId: string;
  role: UserRole;
  canonicalRoleKey?: CanonicalRoleKey | null;
  customRoleId?: string | null;
  customRoleName?: string | null;
  organizationName?: string;
  organizationType?: string;
  status?: string;
}

export interface AccessStationContextSummary {
  assignmentId: string;
  stationId: string;
  stationName: string | null;
  organizationId: string | null;
  role: UserRole;
  isPrimary: boolean;
}

export interface ActiveCustomRoleAccessSummary {
  id: string;
  name: string;
  baseRoleKey: CanonicalRoleKey;
  permissions: string[];
}

export interface AccessProfileInput {
  activeOrganizationId: string | null;
  activeTenantId?: string | null;
  effectiveRole: UserRole;
  effectiveCanonicalRole?: CanonicalRoleKey | null;
  memberships: AccessMembershipSummary[];
  stationContexts: AccessStationContextSummary[];
  activeStationContext: AccessStationContextSummary | null;
  providerId?: string | null;
  customRole?: ActiveCustomRoleAccessSummary | null;
}

@Injectable()
export class AccessProfileService {
  buildProfile(input: AccessProfileInput): AccessProfile {
    const canonicalRole =
      input.customRole?.baseRoleKey ||
      input.effectiveCanonicalRole ||
      resolveCanonicalRoleKey(input.effectiveRole);

    if (!canonicalRole) {
      const fallback = CANONICAL_ROLE_DEFINITIONS.SITE_HOST;
      return {
        version: '2026-04-v2',
        legacyRole: input.effectiveRole,
        canonicalRole: fallback.key,
        canonicalRoleLabel: fallback.label,
        baseRoleKey: fallback.key,
        roleFamily: fallback.family,
        permissionScope: fallback.permissionScope,
        permissions: [...fallback.permissions],
        scope: this.resolveScope(input, fallback.scopeType),
        isCustomRole: false,
        customRoleId: null,
        customRoleName: null,
      };
    }

    const definition = getCanonicalRoleDefinition(canonicalRole);
    if (!definition) {
      throw new Error(`Unknown canonical role ${canonicalRole}`);
    }

    const permissions = input.customRole
      ? this.resolveCustomRolePermissions(definition.key, input.customRole)
      : [...definition.permissions];

    return {
      version: '2026-04-v2',
      legacyRole: input.effectiveRole,
      canonicalRole: definition.key,
      canonicalRoleLabel:
        input.customRole?.name || resolveRoleLabel(definition.key),
      baseRoleKey: definition.key,
      roleFamily: definition.family,
      permissionScope: definition.permissionScope,
      permissions,
      scope: this.resolveScope(input, definition.scopeType),
      isCustomRole: Boolean(input.customRole),
      customRoleId: input.customRole?.id || null,
      customRoleName: input.customRole?.name || null,
    };
  }

  private resolveCustomRolePermissions(
    baseRoleKey: CanonicalRoleKey,
    customRole: ActiveCustomRoleAccessSummary,
  ): string[] {
    const basePermissions = new Set(
      CANONICAL_ROLE_DEFINITIONS[baseRoleKey].permissions,
    );

    return Array.from(
      new Set(
        customRole.permissions.filter(
          (permission) =>
            basePermissions.has(permission) &&
            isTenantScopedPermission(permission),
        ),
      ),
    ).sort();
  }

  private resolveScope(
    input: AccessProfileInput,
    scopeType: AccessScopeType,
  ): AccessScopeSummary {
    const stationIds = Array.from(
      new Set(input.stationContexts.map((context) => context.stationId)),
    );
    const organizationId = input.activeTenantId || input.activeOrganizationId;

    if (scopeType === 'platform') {
      return {
        type: 'platform',
        organizationId,
        tenantId: organizationId,
        stationId: null,
        stationIds,
        providerId: input.providerId || null,
        isTemporary: false,
      };
    }

    if (scopeType === 'provider') {
      return {
        type: 'provider',
        organizationId,
        tenantId: organizationId,
        stationId: null,
        stationIds,
        providerId: input.providerId || null,
        isTemporary: false,
      };
    }

    if (scopeType === 'fleet_group') {
      return {
        type: 'fleet_group',
        organizationId,
        tenantId: organizationId,
        stationId: null,
        stationIds,
        providerId: input.providerId || null,
        isTemporary: false,
      };
    }

    if (scopeType === 'temporary') {
      return {
        type: 'temporary',
        organizationId,
        tenantId: organizationId,
        stationId: input.activeStationContext?.stationId || null,
        stationIds,
        providerId: input.providerId || null,
        isTemporary: true,
      };
    }

    if (scopeType === 'device') {
      return {
        type: 'device',
        organizationId:
          input.activeStationContext?.organizationId || organizationId || null,
        tenantId: organizationId,
        stationId: input.activeStationContext?.stationId || null,
        stationIds,
        providerId: input.providerId || null,
        isTemporary: false,
      };
    }

    if (scopeType === 'station' && input.activeStationContext) {
      return {
        type: 'station',
        organizationId:
          input.activeStationContext.organizationId || organizationId || null,
        tenantId: organizationId,
        stationId: input.activeStationContext.stationId,
        stationIds,
        providerId: input.providerId || null,
        isTemporary: false,
      };
    }

    return {
      type: scopeType === 'site' ? 'site' : 'tenant',
      organizationId,
      tenantId: organizationId,
      stationId: null,
      stationIds,
      providerId: input.providerId || null,
      isTemporary: false,
    };
  }
}

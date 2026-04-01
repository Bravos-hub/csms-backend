export type TenantRoutingTier = 'SHARED' | 'SCHEMA' | 'DEDICATED_DB';

export type TenantRoutingSelection = 'shared' | 'schema' | 'dedicated_db';

export type TenantResolutionSource =
  | 'host_subdomain'
  | 'header_fallback'
  | 'jwt_claim'
  | 'platform_shared'
  | 'none';

export type TenantRoutingHint = {
  organizationId?: string | null;
  routingEnabled?: boolean;
  tier?: TenantRoutingTier;
  schema?: string | null;
};

export type TenantRequestContext = {
  requestId?: string;
  host?: string | null;
  subdomain?: string | null;
  isLocalhost?: boolean;
  headerTenantId?: string | null;
  hostOrganizationId?: string | null;
  hostRoutingEnabled?: boolean;
  hostTier?: TenantRoutingTier;
  hostSchema?: string | null;
  authenticatedOrganizationId?: string | null;
  effectiveOrganizationId?: string | null;
  resolutionSource?: TenantResolutionSource;
  mismatchReason?: string | null;
  mismatchRejected?: boolean;
  routing?: TenantRoutingHint | null;
};

export type TenantRoutingTarget =
  | {
      key: 'shared';
      selection: 'shared';
      connectionString: string;
      organizationId: null;
      schema: null;
    }
  | {
      key: string;
      selection: 'schema' | 'dedicated_db';
      connectionString: string;
      organizationId: string;
      schema: string | null;
    };

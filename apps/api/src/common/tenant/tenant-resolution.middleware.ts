import type { NextFunction, Request, Response } from 'express';
import { TenantContextService } from '@app/db';
import { TenantResolutionService } from './tenant-resolution.service';

export function createTenantResolutionMiddleware(
  tenantContext: TenantContextService,
  resolution: TenantResolutionService,
) {
  return async function tenantResolutionMiddleware(
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const resolved = await resolution.resolveRequest(request);
      const requestId =
        typeof response.locals.requestId === 'string'
          ? response.locals.requestId
          : undefined;

      const initialContext = {
        requestId,
        host: resolved.host,
        isLocalhost: resolved.isLocalhost,
        subdomain: resolved.subdomain,
        headerTenantId: resolved.headerTenantId,
        hostOrganizationId: resolved.hostOrganization?.id || null,
        hostRoutingEnabled:
          resolved.hostOrganization?.tenantRoutingEnabled || false,
        hostTier: resolved.hostOrganization?.tenantTier,
        hostSchema: resolved.hostOrganization?.tenantSchema || null,
        authenticatedOrganizationId: null,
        effectiveOrganizationId: resolved.provisionalOrganization?.id || null,
        mismatchReason: null,
        mismatchRejected: false,
        resolutionSource: resolved.resolutionSource,
        routing: null,
      } as const;

      tenantContext.run(initialContext, () => {
        response.locals.tenantResolutionSource = resolved.resolutionSource;
        response.locals.tenantOrganizationId =
          initialContext.effectiveOrganizationId;
        response.locals.tenantRoutingTier =
          resolved.provisionalOrganization?.tenantTier || 'SHARED';
        response.locals.tenantMismatchReason = null;
        next();
      });
    } catch (error) {
      next(error);
    }
  };
}

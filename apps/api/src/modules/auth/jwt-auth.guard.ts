import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import * as jwt from 'jsonwebtoken';
import type { Request, Response } from 'express';
import { TenantContextService } from '@app/db';
import type { CanonicalRoleKey } from '@app/domain';
import { HttpMetricsService } from '../../common/observability/http-metrics.service';
import { TenantDirectoryService } from '../../common/tenant/tenant-directory.service';
import { IS_PUBLIC_KEY } from './public.decorator';

type JwtUserClaims = jwt.JwtPayload & {
  role?: string;
  canonicalRole?: CanonicalRoleKey;
  permissions?: string[];
  organizationId?: string;
  activeOrganizationId?: string;
  tenantId?: string;
  activeTenantId?: string;
  orgId?: string;
  accessProfile?: {
    canonicalRole?: CanonicalRoleKey;
    permissions?: string[];
  };
};

type AuthenticatedRequest = Request & {
  user?: JwtUserClaims;
};

type TenantResponseLocals = {
  tenantResolutionSource?: string | null;
  tenantOrganizationId?: string | null;
  tenantRoutingTier?: string | null;
  tenantMismatchReason?: string | null;
};

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService<Record<string, unknown>>,
    private readonly reflector: Reflector,
    private readonly tenantContext: TenantContextService,
    private readonly tenantDirectory: TenantDirectoryService,
    private readonly metrics: HttpMetricsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    const responseLocals = response.locals as TenantResponseLocals;
    const rawAuthHeader = request.headers.authorization;
    const authHeader =
      typeof rawAuthHeader === 'string' ? rawAuthHeader : undefined;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException(
        'Missing or invalid authorization header',
      );
    }

    const token = authHeader.slice(7);
    const configuredSecret = this.config.get<string>('JWT_SECRET');
    const secret =
      typeof configuredSecret === 'string' ? configuredSecret : undefined;

    if (!secret) {
      throw new Error('JWT_SECRET not configured');
    }

    try {
      const verified = jwt.verify(token, secret);
      if (
        !verified ||
        typeof verified !== 'object' ||
        Array.isArray(verified)
      ) {
        throw new UnauthorizedException('Invalid token payload');
      }

      const payload = verified as JwtUserClaims;
      request.user = payload;

      const authenticatedOrganizationId =
        payload.activeTenantId ||
        payload.tenantId ||
        payload.activeOrganizationId ||
        payload.organizationId ||
        payload.orgId ||
        null;

      const existingContext = this.tenantContext.get();
      const hostOrganizationId = existingContext?.hostOrganizationId || null;

      if (
        hostOrganizationId &&
        authenticatedOrganizationId !== hostOrganizationId
      ) {
        this.metrics.recordTenantMismatchReject();
        this.tenantContext.set({
          authenticatedOrganizationId,
          mismatchRejected: true,
          mismatchReason: 'host_jwt_mismatch',
        });
        responseLocals.tenantMismatchReason = 'host_jwt_mismatch';
        throw new ForbiddenException(
          'Tenant mismatch between request host and authenticated user context',
        );
      }

      const effectiveOrganizationId =
        hostOrganizationId || authenticatedOrganizationId;
      const organizationRoute = effectiveOrganizationId
        ? await this.tenantDirectory.findByOrganizationId(
            effectiveOrganizationId,
          )
        : null;

      const routing = organizationRoute
        ? this.tenantDirectory.toRoutingHint(organizationRoute)
        : null;

      const selection = routing?.routingEnabled
        ? routing.tier === 'DEDICATED_DB'
          ? 'dedicated_db'
          : routing.tier === 'SCHEMA'
            ? 'schema'
            : 'shared'
        : 'shared';

      this.metrics.recordTenantRoutingSelection(selection);
      this.tenantContext.set({
        authenticatedOrganizationId,
        effectiveOrganizationId: effectiveOrganizationId || null,
        mismatchRejected: false,
        mismatchReason: null,
        resolutionSource: hostOrganizationId ? 'host_subdomain' : 'jwt_claim',
        routing,
      });

      responseLocals.tenantResolutionSource = hostOrganizationId
        ? 'host_subdomain'
        : 'jwt_claim';
      responseLocals.tenantOrganizationId = effectiveOrganizationId || null;
      responseLocals.tenantRoutingTier =
        routing?.routingEnabled && routing.tier ? routing.tier : 'SHARED';
      responseLocals.tenantMismatchReason = null;

      return true;
    } catch (error) {
      if (
        error instanceof ForbiddenException ||
        error instanceof UnauthorizedException
      ) {
        throw error;
      }
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}

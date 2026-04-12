import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import type { Request, Response } from 'express';
import { TenantContextService } from '@app/db';
import { HttpMetricsService } from '../../common/observability/http-metrics.service';

type ServiceTokenClaims = jwt.JwtPayload & {
  type?: string;
};

type ServiceAuthenticatedRequest = Request & {
  service?: ServiceTokenClaims;
};

type TenantResponseLocals = {
  tenantResolutionSource?: string | null;
  tenantOrganizationId?: string | null;
  tenantRoutingTier?: string | null;
  tenantMismatchReason?: string | null;
};

@Injectable()
export class ServiceAuthGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService<Record<string, unknown>>,
    private readonly tenantContext: TenantContextService,
    private readonly metrics: HttpMetricsService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<ServiceAuthenticatedRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    const responseLocals = response.locals as TenantResponseLocals;
    const rawAuthorization = request.headers.authorization;
    const authHeader =
      typeof rawAuthorization === 'string' ? rawAuthorization : undefined;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException(
        'Missing or invalid authorization header',
      );
    }

    const token = authHeader.slice(7);
    const configuredSecret = this.config.get<string>('JWT_SERVICE_SECRET');
    const secret =
      typeof configuredSecret === 'string' ? configuredSecret : undefined;

    if (!secret) {
      throw new Error('JWT_SERVICE_SECRET not configured');
    }

    const verifyOptions: jwt.VerifyOptions = {};
    const configuredIssuer = this.config.get<string>('JWT_SERVICE_ISSUER');
    const issuer =
      typeof configuredIssuer === 'string' ? configuredIssuer : undefined;
    const configuredAudience = this.config.get<string>('JWT_SERVICE_AUDIENCE');
    const audience =
      typeof configuredAudience === 'string' ? configuredAudience : undefined;
    if (issuer) verifyOptions.issuer = issuer;
    if (audience) verifyOptions.audience = audience;

    try {
      const verified = jwt.verify(token, secret, verifyOptions);
      if (
        !verified ||
        typeof verified !== 'object' ||
        Array.isArray(verified)
      ) {
        throw new UnauthorizedException('Invalid token payload');
      }
      const payload = verified as ServiceTokenClaims;
      const tokenType = String(payload?.type || '').toLowerCase();
      if (tokenType !== 'service') {
        throw new UnauthorizedException('Invalid token type');
      }

      request.service = payload;

      const current = this.tenantContext.get();
      const hostOrganizationId = current?.hostOrganizationId || null;
      const routing = hostOrganizationId
        ? {
            organizationId: hostOrganizationId,
            routingEnabled: current?.hostRoutingEnabled || false,
            tier: current?.hostTier || 'SHARED',
            schema: current?.hostSchema || null,
          }
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
        authenticatedOrganizationId: null,
        effectiveOrganizationId: hostOrganizationId,
        resolutionSource: hostOrganizationId
          ? current?.resolutionSource === 'host_custom_domain'
            ? 'host_custom_domain'
            : 'host_subdomain'
          : 'platform_shared',
        mismatchReason: null,
        mismatchRejected: false,
        routing,
      });

      responseLocals.tenantResolutionSource = hostOrganizationId
        ? current?.resolutionSource === 'host_custom_domain'
          ? 'host_custom_domain'
          : 'host_subdomain'
        : 'platform_shared';
      responseLocals.tenantOrganizationId = hostOrganizationId;
      responseLocals.tenantRoutingTier =
        routing?.routingEnabled && routing.tier ? routing.tier : 'SHARED';
      responseLocals.tenantMismatchReason = null;

      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}

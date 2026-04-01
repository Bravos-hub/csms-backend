import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TenantContextService } from '@app/db';
import { HttpMetricsService } from '../../common/observability/http-metrics.service';
import { ServiceAuthGuard } from './service-auth.guard';

function createExecutionContext(request: any, response: any): any {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  };
}

describe('ServiceAuthGuard', () => {
  const config = {
    get: jest.fn(),
  } as unknown as ConfigService;

  const tenantContext = new TenantContextService();

  const metrics = {
    recordTenantRoutingSelection: jest.fn(),
  } as unknown as HttpMetricsService;

  const guard = new ServiceAuthGuard(config, tenantContext, metrics);

  beforeEach(() => {
    (config.get as jest.Mock).mockReset();
    (metrics.recordTenantRoutingSelection as jest.Mock).mockReset();

    (config.get as jest.Mock).mockImplementation((key: string) => {
      if (key === 'JWT_SERVICE_SECRET') return 'service-secret';
      return undefined;
    });
  });

  it('finalizes host-based tenant context for service tokens', () => {
    const token = require('jsonwebtoken').sign(
      {
        sub: 'svc-1',
        type: 'service',
        scopes: ['ocpi:commands'],
      },
      'service-secret',
    );

    const request = {
      headers: { authorization: `Bearer ${token}` },
    };
    const response = { locals: {} };

    const allowed = tenantContext.run(
      {
        hostOrganizationId: 'org-host',
        hostRoutingEnabled: true,
        hostTier: 'SCHEMA',
        hostSchema: 'tenant_org_host',
      },
      () => guard.canActivate(createExecutionContext(request, response)),
    );

    expect(allowed).toBe(true);
    expect(response.locals.tenantResolutionSource).toBe('host_subdomain');
    expect(response.locals.tenantOrganizationId).toBe('org-host');
    expect(
      metrics.recordTenantRoutingSelection as jest.Mock,
    ).toHaveBeenCalledWith('schema');
  });

  it('keeps service token platform-scoped when no host tenant exists', () => {
    const token = require('jsonwebtoken').sign(
      {
        sub: 'svc-1',
        type: 'service',
      },
      'service-secret',
    );

    const request = {
      headers: { authorization: `Bearer ${token}` },
    };
    const response = { locals: {} };

    const allowed = tenantContext.run({}, () =>
      guard.canActivate(createExecutionContext(request, response)),
    );

    expect(allowed).toBe(true);
    expect(response.locals.tenantResolutionSource).toBe('platform_shared');
    expect(response.locals.tenantOrganizationId).toBeNull();
    expect(
      metrics.recordTenantRoutingSelection as jest.Mock,
    ).toHaveBeenCalledWith('shared');
  });

  it('rejects non-service token type', () => {
    const token = require('jsonwebtoken').sign(
      {
        sub: 'user-1',
        type: 'access',
      },
      'service-secret',
    );

    const request = {
      headers: { authorization: `Bearer ${token}` },
    };

    expect(() =>
      guard.canActivate(createExecutionContext(request, { locals: {} })),
    ).toThrow(UnauthorizedException);
  });
});

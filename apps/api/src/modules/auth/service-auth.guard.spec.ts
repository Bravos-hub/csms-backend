import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sign } from 'jsonwebtoken';
import { TenantContextService } from '@app/db';
import { HttpMetricsService } from '../../common/observability/http-metrics.service';
import { ServiceAuthGuard } from './service-auth.guard';

type GuardRequest = {
  headers: {
    authorization?: string;
  };
};

type GuardResponse = {
  locals: Record<string, unknown>;
};

function createExecutionContext(
  request: GuardRequest,
  response: GuardResponse,
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: <T = GuardRequest>() => request as unknown as T,
      getResponse: <T = GuardResponse>() => response as unknown as T,
      getNext: <T = unknown>() => undefined as T,
    }),
  } as unknown as ExecutionContext;
}

describe('ServiceAuthGuard', () => {
  const configGet = jest.fn<(key: string) => unknown>();
  const recordTenantRoutingSelection = jest.fn();

  const config = {
    get: configGet,
  } as unknown as ConfigService;

  const tenantContext = new TenantContextService();

  const metrics = {
    recordTenantRoutingSelection,
  } as unknown as HttpMetricsService;

  const guard = new ServiceAuthGuard(config, tenantContext, metrics);

  beforeEach(() => {
    configGet.mockReset();
    recordTenantRoutingSelection.mockReset();

    configGet.mockImplementation((key: string) => {
      if (key === 'JWT_SERVICE_SECRET') return 'service-secret';
      return undefined;
    });
  });

  it('finalizes host-based tenant context for service tokens', () => {
    const token = sign(
      {
        sub: 'svc-1',
        type: 'service',
        scopes: ['ocpi:commands'],
      },
      'service-secret',
    );

    const request: GuardRequest = {
      headers: { authorization: `Bearer ${token}` },
    };
    const response: GuardResponse = { locals: {} };

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
    expect(recordTenantRoutingSelection).toHaveBeenCalledWith('schema');
  });

  it('keeps service token platform-scoped when no host tenant exists', () => {
    const token = sign(
      {
        sub: 'svc-1',
        type: 'service',
      },
      'service-secret',
    );

    const request: GuardRequest = {
      headers: { authorization: `Bearer ${token}` },
    };
    const response: GuardResponse = { locals: {} };

    const allowed = tenantContext.run({}, () =>
      guard.canActivate(createExecutionContext(request, response)),
    );

    expect(allowed).toBe(true);
    expect(response.locals.tenantResolutionSource).toBe('platform_shared');
    expect(response.locals.tenantOrganizationId).toBeNull();
    expect(recordTenantRoutingSelection).toHaveBeenCalledWith('shared');
  });

  it('rejects non-service token type', () => {
    const token = sign(
      {
        sub: 'user-1',
        type: 'access',
      },
      'service-secret',
    );

    const request: GuardRequest = {
      headers: { authorization: `Bearer ${token}` },
    };

    expect(() =>
      guard.canActivate(createExecutionContext(request, { locals: {} })),
    ).toThrow(UnauthorizedException);
  });
});

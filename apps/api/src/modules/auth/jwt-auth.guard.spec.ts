import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { TenantContextService } from '@app/db';
import { HttpMetricsService } from '../../common/observability/http-metrics.service';
import { TenantDirectoryService } from '../../common/tenant/tenant-directory.service';
import { JwtAuthGuard } from './jwt-auth.guard';

function createExecutionContext(request: any, response: any): any {
  return {
    getHandler: () => null,
    getClass: () => null,
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  };
}

describe('JwtAuthGuard', () => {
  const config = {
    get: jest.fn(),
  } as unknown as ConfigService;

  const reflector = {
    getAllAndOverride: jest.fn(),
  } as unknown as Reflector;

  const tenantContext = new TenantContextService();

  const tenantDirectory = {
    findByOrganizationId: jest.fn(),
    toRoutingHint: jest.fn(),
  } as unknown as TenantDirectoryService;

  const metrics = {
    recordTenantRoutingSelection: jest.fn(),
    recordTenantMismatchReject: jest.fn(),
  } as unknown as HttpMetricsService;

  const guard = new JwtAuthGuard(
    config,
    reflector,
    tenantContext,
    tenantDirectory,
    metrics,
  );

  beforeEach(() => {
    (config.get as jest.Mock).mockReset();
    (reflector.getAllAndOverride as jest.Mock).mockReset();
    (tenantDirectory.findByOrganizationId as jest.Mock).mockReset();
    (tenantDirectory.toRoutingHint as jest.Mock).mockReset();
    (metrics.recordTenantRoutingSelection as jest.Mock).mockReset();
    (metrics.recordTenantMismatchReject as jest.Mock).mockReset();

    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(false);
    (config.get as jest.Mock).mockImplementation((key: string) => {
      if (key === 'JWT_SECRET') return 'jwt-secret';
      return undefined;
    });
  });

  it('accepts matching host and JWT tenant context', async () => {
    const request = {
      headers: {
        authorization:
          'Bearer ' +
          require('jsonwebtoken').sign(
            {
              sub: 'user-1',
              role: 'STATION_OWNER',
              organizationId: 'org-1',
              activeOrganizationId: 'org-1',
            },
            'jwt-secret',
          ),
      },
    };
    const response = { locals: {} };

    (tenantDirectory.findByOrganizationId as jest.Mock).mockResolvedValue({
      id: 'org-1',
    });
    (tenantDirectory.toRoutingHint as jest.Mock).mockReturnValue({
      organizationId: 'org-1',
      routingEnabled: true,
      tier: 'SCHEMA',
      schema: 'tenant_org_1',
    });

    const result = await tenantContext.run(
      {
        hostOrganizationId: 'org-1',
        hostRoutingEnabled: true,
        hostTier: 'SCHEMA',
        hostSchema: 'tenant_org_1',
      },
      () => guard.canActivate(createExecutionContext(request, response)),
    );

    expect(result).toBe(true);
    expect(
      metrics.recordTenantRoutingSelection as jest.Mock,
    ).toHaveBeenCalledWith('schema');
    expect(response.locals.tenantMismatchReason).toBeNull();
  });

  it('rejects host/JWT tenant mismatch with 403', async () => {
    const request = {
      headers: {
        authorization:
          'Bearer ' +
          require('jsonwebtoken').sign(
            {
              sub: 'user-1',
              role: 'STATION_OWNER',
              organizationId: 'org-2',
              activeOrganizationId: 'org-2',
            },
            'jwt-secret',
          ),
      },
    };
    const response = { locals: {} };

    await expect(
      tenantContext.run(
        {
          hostOrganizationId: 'org-1',
          hostRoutingEnabled: true,
          hostTier: 'SHARED',
          hostSchema: null,
        },
        () => guard.canActivate(createExecutionContext(request, response)),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(metrics.recordTenantMismatchReject as jest.Mock).toHaveBeenCalled();
    expect(response.locals.tenantMismatchReason).toBe('host_jwt_mismatch');
  });

  it('rejects when host tenant is present but JWT has no organization claim', async () => {
    const request = {
      headers: {
        authorization:
          'Bearer ' +
          require('jsonwebtoken').sign(
            {
              sub: 'user-1',
              role: 'STATION_OWNER',
            },
            'jwt-secret',
          ),
      },
    };
    const response = { locals: {} };

    await expect(
      tenantContext.run(
        {
          hostOrganizationId: 'org-1',
          hostRoutingEnabled: true,
          hostTier: 'SHARED',
          hostSchema: null,
        },
        () => guard.canActivate(createExecutionContext(request, response)),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(response.locals.tenantMismatchReason).toBe('host_jwt_mismatch');
  });

  it('rejects missing authorization header', async () => {
    const request = {
      headers: {},
    };

    await expect(
      guard.canActivate(createExecutionContext(request, { locals: {} })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('uses JWT organization when host context is absent', async () => {
    const request = {
      headers: {
        authorization:
          'Bearer ' +
          require('jsonwebtoken').sign(
            {
              sub: 'user-1',
              role: 'STATION_OWNER',
              organizationId: 'org-10',
            },
            'jwt-secret',
          ),
      },
    };
    const response = { locals: {} };

    (tenantDirectory.findByOrganizationId as jest.Mock).mockResolvedValue({
      id: 'org-10',
    });
    (tenantDirectory.toRoutingHint as jest.Mock).mockReturnValue({
      organizationId: 'org-10',
      routingEnabled: false,
      tier: 'SHARED',
      schema: null,
    });

    const result = await tenantContext.run({}, () =>
      guard.canActivate(createExecutionContext(request, response)),
    );

    expect(result).toBe(true);
    expect(response.locals.tenantResolutionSource).toBe('jwt_claim');
    expect(response.locals.tenantOrganizationId).toBe('org-10');
  });
});

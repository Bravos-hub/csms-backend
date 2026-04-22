import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { sign } from 'jsonwebtoken';
import { TenantContextService } from '@app/db';
import { HttpMetricsService } from '../../common/observability/http-metrics.service';
import { TenantDirectoryService } from '../../common/tenant/tenant-directory.service';
import { JwtAuthGuard } from './jwt-auth.guard';

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
  contextType: 'http' | 'rpc' = 'http',
): ExecutionContext {
  return {
    getType: () => contextType,
    getHandler: () => null,
    getClass: () => null,
    switchToHttp: () => ({
      getRequest: <T = GuardRequest>() => request as unknown as T,
      getResponse: <T = GuardResponse>() => response as unknown as T,
      getNext: <T = unknown>() => undefined as T,
    }),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  const configGet = jest.fn<(key: string) => unknown>();
  const reflectorGetAllAndOverride = jest.fn();
  const tenantDirectoryFindByOrganizationId = jest.fn();
  const tenantDirectoryToRoutingHint = jest.fn();
  const recordTenantRoutingSelection = jest.fn();
  const recordTenantMismatchReject = jest.fn();

  const config = {
    get: configGet,
  } as unknown as ConfigService;

  const reflector = {
    getAllAndOverride: reflectorGetAllAndOverride,
  } as unknown as Reflector;

  const tenantContext = new TenantContextService();

  const tenantDirectory = {
    findByOrganizationId: tenantDirectoryFindByOrganizationId,
    toRoutingHint: tenantDirectoryToRoutingHint,
  } as unknown as TenantDirectoryService;

  const metrics = {
    recordTenantRoutingSelection,
    recordTenantMismatchReject,
  } as unknown as HttpMetricsService;

  const guard = new JwtAuthGuard(
    config,
    reflector,
    tenantContext,
    tenantDirectory,
    metrics,
  );

  beforeEach(() => {
    configGet.mockReset();
    reflectorGetAllAndOverride.mockReset();
    tenantDirectoryFindByOrganizationId.mockReset();
    tenantDirectoryToRoutingHint.mockReset();
    recordTenantRoutingSelection.mockReset();
    recordTenantMismatchReject.mockReset();

    reflectorGetAllAndOverride.mockReturnValue(false);
    configGet.mockImplementation((key: string) => {
      if (key === 'JWT_SECRET') return 'jwt-secret';
      return undefined;
    });
  });

  it('accepts matching host and JWT tenant context', async () => {
    const request: GuardRequest = {
      headers: {
        authorization: `Bearer ${sign(
          {
            sub: 'user-1',
            role: 'STATION_OWNER',
            organizationId: 'org-1',
            activeOrganizationId: 'org-1',
          },
          'jwt-secret',
        )}`,
      },
    };
    const response: GuardResponse = { locals: {} };

    tenantDirectoryFindByOrganizationId.mockResolvedValue({
      id: 'org-1',
    });
    tenantDirectoryToRoutingHint.mockReturnValue({
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
    expect(recordTenantRoutingSelection).toHaveBeenCalledWith('schema');
    expect(response.locals.tenantMismatchReason).toBeNull();
  });

  it('rejects host/JWT tenant mismatch with 403', async () => {
    const request: GuardRequest = {
      headers: {
        authorization: `Bearer ${sign(
          {
            sub: 'user-1',
            role: 'STATION_OWNER',
            organizationId: 'org-2',
            activeOrganizationId: 'org-2',
          },
          'jwt-secret',
        )}`,
      },
    };
    const response: GuardResponse = { locals: {} };

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

    expect(recordTenantMismatchReject).toHaveBeenCalled();
    expect(response.locals.tenantMismatchReason).toBe('host_jwt_mismatch');
  });

  it('rejects when host tenant is present but JWT has no organization claim', async () => {
    const request: GuardRequest = {
      headers: {
        authorization: `Bearer ${sign(
          {
            sub: 'user-1',
            role: 'STATION_OWNER',
          },
          'jwt-secret',
        )}`,
      },
    };
    const response: GuardResponse = { locals: {} };

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
    const request: GuardRequest = {
      headers: {},
    };

    await expect(
      guard.canActivate(createExecutionContext(request, { locals: {} })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('uses JWT organization when host context is absent', async () => {
    const request: GuardRequest = {
      headers: {
        authorization: `Bearer ${sign(
          {
            sub: 'user-1',
            role: 'STATION_OWNER',
            organizationId: 'org-10',
          },
          'jwt-secret',
        )}`,
      },
    };
    const response: GuardResponse = { locals: {} };

    tenantDirectoryFindByOrganizationId.mockResolvedValue({
      id: 'org-10',
    });
    tenantDirectoryToRoutingHint.mockReturnValue({
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

  it('treats explicit platform sessions as non-tenant routable even when legacy tenant ids exist', async () => {
    const request: GuardRequest = {
      headers: {
        authorization: `Bearer ${sign(
          {
            sub: 'platform-user-1',
            role: 'SUPER_ADMIN',
            canonicalRole: 'PLATFORM_SUPER_ADMIN',
            sessionScopeType: 'platform',
            actingAsTenant: false,
            organizationId: 'org-legacy',
            activeTenantId: 'org-legacy',
          },
          'jwt-secret',
        )}`,
      },
    };
    const response: GuardResponse = { locals: {} };

    const result = await tenantContext.run({}, () =>
      guard.canActivate(createExecutionContext(request, response)),
    );

    expect(result).toBe(true);
    expect(response.locals.tenantOrganizationId).toBeNull();
    expect(tenantDirectoryFindByOrganizationId).not.toHaveBeenCalled();
  });

  it('uses selectedTenantId for explicit tenant impersonation sessions', async () => {
    const request: GuardRequest = {
      headers: {
        authorization: `Bearer ${sign(
          {
            sub: 'platform-user-1',
            role: 'SUPER_ADMIN',
            canonicalRole: 'PLATFORM_SUPER_ADMIN',
            sessionScopeType: 'tenant',
            actingAsTenant: true,
            selectedTenantId: 'org-tenant-22',
          },
          'jwt-secret',
        )}`,
      },
    };
    const response: GuardResponse = { locals: {} };

    tenantDirectoryFindByOrganizationId.mockResolvedValue({
      id: 'org-tenant-22',
    });
    tenantDirectoryToRoutingHint.mockReturnValue({
      organizationId: 'org-tenant-22',
      routingEnabled: false,
      tier: 'SHARED',
      schema: null,
    });

    const result = await tenantContext.run({}, () =>
      guard.canActivate(createExecutionContext(request, response)),
    );

    expect(result).toBe(true);
    expect(response.locals.tenantOrganizationId).toBe('org-tenant-22');
  });

  it('skips HTTP authorization parsing for RPC execution contexts', async () => {
    const result = await guard.canActivate(
      createExecutionContext({ headers: {} }, { locals: {} }, 'rpc'),
    );

    expect(result).toBe(true);
    expect(tenantDirectoryFindByOrganizationId).not.toHaveBeenCalled();
  });
});

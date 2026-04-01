import { TenantResolutionService } from './tenant-resolution.service';
import type { Request } from 'express';
import { TenantRoutingConfigService } from '@app/db';
import { TenantDirectoryService } from './tenant-directory.service';

describe('TenantResolutionService', () => {
  const createRequest = (
    headers: Partial<Record<'host' | 'x-tenant-id', string>>,
  ): Request =>
    ({
      header: (name: string) => headers[name as 'host' | 'x-tenant-id'],
    }) as unknown as Request;

  const config = {
    getPlatformHosts: jest.fn(),
    isHeaderFallbackEnabledForLocalhost: jest.fn(),
  };

  const directory = {
    findBySubdomain: jest.fn(),
    findByHeaderTenant: jest.fn(),
  };

  const service = new TenantResolutionService(
    config as unknown as TenantRoutingConfigService,
    directory as unknown as TenantDirectoryService,
  );

  beforeEach(() => {
    config.getPlatformHosts.mockReset();
    config.isHeaderFallbackEnabledForLocalhost.mockReset();
    directory.findBySubdomain.mockReset();
    directory.findByHeaderTenant.mockReset();

    config.getPlatformHosts.mockReturnValue(['portal.evzonecharging.com']);
    config.isHeaderFallbackEnabledForLocalhost.mockImplementation(
      (isLocalhost: boolean) => isLocalhost,
    );
  });

  it('resolves tenant from subdomain host', async () => {
    directory.findBySubdomain.mockResolvedValue({
      id: 'org-host',
      tenantSubdomain: 'acme',
      tenantRoutingEnabled: true,
      tenantTier: 'SCHEMA',
      tenantSchema: 'tenant_acme',
    });

    const request = createRequest({
      host: 'acme.portal.evzonecharging.com',
    });

    const result = await service.resolveRequest(request);

    expect(directory.findBySubdomain).toHaveBeenCalledWith('acme');
    expect(result.resolutionSource).toBe('host_subdomain');
    expect(result.provisionalOrganization?.id).toBe('org-host');
    expect(result.headerOrganization).toBeNull();
  });

  it('allows localhost header fallback when enabled', async () => {
    directory.findBySubdomain.mockResolvedValue(null);
    directory.findByHeaderTenant.mockResolvedValue({
      id: 'org-header',
      tenantSubdomain: 'header',
      tenantRoutingEnabled: true,
      tenantTier: 'SHARED',
      tenantSchema: null,
    });

    const request = createRequest({
      host: 'localhost:3000',
      'x-tenant-id': 'org-header',
    });

    const result = await service.resolveRequest(request);

    expect(config.isHeaderFallbackEnabledForLocalhost).toHaveBeenCalledWith(
      true,
    );
    expect(directory.findByHeaderTenant).toHaveBeenCalledWith('org-header');
    expect(result.resolutionSource).toBe('header_fallback');
    expect(result.provisionalOrganization?.id).toBe('org-header');
  });

  it('returns none when host and header do not resolve a tenant', async () => {
    directory.findBySubdomain.mockResolvedValue(null);
    directory.findByHeaderTenant.mockResolvedValue(null);

    const request = createRequest({});

    const result = await service.resolveRequest(request);

    expect(result.resolutionSource).toBe('none');
    expect(result.provisionalOrganization).toBeNull();
    expect(result.host).toBeNull();
  });

  it('does not use header fallback in non-localhost hosts', async () => {
    directory.findBySubdomain.mockResolvedValue(null);

    const request = createRequest({
      host: 'api.evzonecharging.com',
      'x-tenant-id': 'org-header',
    });

    const result = await service.resolveRequest(request);

    expect(config.isHeaderFallbackEnabledForLocalhost).toHaveBeenCalledWith(
      false,
    );
    expect(directory.findByHeaderTenant).not.toHaveBeenCalled();
    expect(result.resolutionSource).toBe('none');
  });
});

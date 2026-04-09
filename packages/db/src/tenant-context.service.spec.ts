import { TenantContextService } from './tenant-context.service';

describe('TenantContextService', () => {
  it('mutates the active context in place when one exists', () => {
    const service = new TenantContextService();

    service.run(
      {
        requestId: 'req-1',
        effectiveOrganizationId: null,
      },
      () => {
        const before = service.get();
        expect(before).toBeDefined();

        const updated = service.set({
          authenticatedOrganizationId: 'org-1',
          effectiveOrganizationId: 'org-1',
          resolutionSource: 'jwt_claim',
        });

        expect(updated).toBe(before);
        expect(service.get()).toBe(before);
        expect(service.get()).toMatchObject({
          requestId: 'req-1',
          authenticatedOrganizationId: 'org-1',
          effectiveOrganizationId: 'org-1',
          resolutionSource: 'jwt_claim',
        });
      },
    );
  });

  it('creates a context when no active context exists', () => {
    const service = new TenantContextService();

    const created = service.set({
      effectiveOrganizationId: 'org-2',
      resolutionSource: 'jwt_claim',
    });

    expect(created).toMatchObject({
      effectiveOrganizationId: 'org-2',
      resolutionSource: 'jwt_claim',
    });
    expect(service.get()).toBe(created);
  });
});

import { BadRequestException } from '@nestjs/common';
import { MembershipStatus, UserRole } from '@prisma/client';
import { TenantContextService, TenantRoutingConfigService } from '@app/db';
import { PrismaService } from '../../prisma.service';
import { MediaStorageService } from '../../common/services/media-storage.service';
import { TenantBrandingService } from './tenant-branding.service';

describe('TenantBrandingService', () => {
  const controlPlane = {
    user: {
      findUnique: jest.fn(),
    },
    organizationMembership: {
      findUnique: jest.fn(),
    },
    organization: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    tenantBrandingRevision: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const prisma = {
    getControlPlaneClient: jest.fn(),
    auditLog: {
      create: jest.fn(),
    },
  };

  const tenantContext = {
    get: jest.fn(),
  };

  const tenantRoutingConfig = {
    getPlatformHosts: jest.fn(),
  };

  const mediaStorage = {
    uploadBuffer: jest.fn(),
  };

  const service = new TenantBrandingService(
    prisma as unknown as PrismaService,
    tenantContext as unknown as TenantContextService,
    tenantRoutingConfig as unknown as TenantRoutingConfigService,
    mediaStorage as unknown as MediaStorageService,
  );

  beforeEach(() => {
    jest.clearAllMocks();

    prisma.getControlPlaneClient.mockReturnValue(controlPlane);
    controlPlane.$transaction.mockImplementation(
      async (callback: (tx: typeof controlPlane) => Promise<unknown>) =>
        callback(controlPlane),
    );

    tenantContext.get.mockReturnValue({
      effectiveOrganizationId: 'tenant-1',
      authenticatedOrganizationId: 'tenant-1',
    });

    tenantRoutingConfig.getPlatformHosts.mockReturnValue([
      'portal.evzonecharging.com',
    ]);

    controlPlane.user.findUnique.mockResolvedValue({
      role: UserRole.STATION_ADMIN,
    });
    controlPlane.organizationMembership.findUnique.mockResolvedValue({
      status: MembershipStatus.ACTIVE,
    });

    controlPlane.organization.findUnique.mockResolvedValue({
      id: 'tenant-1',
      name: 'Acme Charge',
      logoUrl: null,
      tenantSubdomain: 'acme',
      primaryDomain: null,
      whiteLabelConfig: null,
      allowedOrigins: [],
    });

    controlPlane.tenantBrandingRevision.findFirst.mockResolvedValue(null);
    controlPlane.tenantBrandingRevision.findMany.mockResolvedValue([]);
    prisma.auditLog.create.mockResolvedValue({});
  });

  it('rejects invalid draft colors', async () => {
    await expect(
      service.saveDraftForTenantActor('user-1', {
        schemaVersion: 1,
        theme: {
          primaryColor: 'not-a-color',
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(controlPlane.$transaction).not.toHaveBeenCalled();
  });

  it('publishes a tenant draft and updates active organization branding fields', async () => {
    const fullConfig = {
      schemaVersion: 1,
      branding: {
        appName: 'Acme Control Center',
        shortName: 'Acme',
        logoUrl: 'https://cdn.acme.test/logo.png',
        logoIconUrl: null,
        faviconUrl: null,
      },
      theme: {
        primaryColor: '#14C78B',
        accentColor: '#0EA672',
        borderRadiusPx: 12,
        fontFamily: 'Inter',
      },
      legal: {
        termsUrl: null,
        privacyUrl: null,
        supportUrl: null,
      },
      support: {
        email: 'ops@acme.test',
        phone: null,
      },
      domain: {
        primaryDomain: 'portal.acme.com',
        allowedOrigins: ['https://portal.acme.com'],
      },
      metadata: {
        lastEditedBy: 'user-1',
        lastEditedAt: new Date().toISOString(),
      },
    };

    controlPlane.user.findUnique.mockResolvedValue({
      role: UserRole.EVZONE_ADMIN,
    });
    controlPlane.organization.findUnique
      .mockResolvedValueOnce({
        id: 'tenant-1',
        name: 'Acme Charge',
        logoUrl: null,
        tenantSubdomain: 'acme',
        primaryDomain: null,
        whiteLabelConfig: null,
        allowedOrigins: [],
      })
      .mockResolvedValueOnce({
        id: 'tenant-1',
        name: 'Acme Charge',
        logoUrl: null,
        tenantSubdomain: 'acme',
        primaryDomain: null,
        whiteLabelConfig: null,
        allowedOrigins: [],
      });

    controlPlane.tenantBrandingRevision.findFirst
      .mockResolvedValueOnce({
        id: 'draft-1',
        organizationId: 'tenant-1',
        version: 3,
        status: 'DRAFT',
        config: fullConfig,
        publishedAt: null,
        rolledBackFromVersion: null,
        createdBy: 'user-1',
        updatedBy: 'user-1',
        createdAt: new Date('2026-04-12T09:00:00.000Z'),
        updatedAt: new Date('2026-04-12T10:00:00.000Z'),
      })
      .mockResolvedValueOnce(null);

    const postPublishState = {
      tenantId: 'tenant-1',
      tenantName: 'Acme Charge',
      activeConfig: fullConfig,
      draft: null,
      revisions: [],
    };

    jest
      .spyOn(service as any, 'getBrandingState')
      .mockResolvedValue(postPublishState);

    const result = await service.publishDraftForPlatformActor(
      'admin-1',
      'tenant-1',
    );

    const organizationUpdateCalls = controlPlane.organization.update.mock
      .calls as Array<
      [
        {
          where?: { id?: string };
          data?: {
            logoUrl?: string | null;
            primaryDomain?: string | null;
            allowedOrigins?: string[];
          };
        },
      ]
    >;
    const organizationUpdateCall = organizationUpdateCalls[0]?.[0];
    expect(organizationUpdateCall?.where?.id).toBe('tenant-1');
    expect(organizationUpdateCall?.data?.logoUrl).toBe(
      'https://cdn.acme.test/logo.png',
    );
    expect(organizationUpdateCall?.data?.primaryDomain).toBe('portal.acme.com');
    expect(organizationUpdateCall?.data?.allowedOrigins).toEqual([
      'https://portal.acme.com',
    ]);
    expect(controlPlane.tenantBrandingRevision.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'draft-1' },
      }),
    );
    const auditCreateCalls = prisma.auditLog.create.mock.calls as Array<
      [{ data?: { action?: string } }]
    >;
    const publishAuditCall = auditCreateCalls.find(
      (call) => call[0]?.data?.action === 'BRANDING_PUBLISHED',
    );
    expect(publishAuditCall).toBeDefined();
    expect(result).toEqual(postPublishState);
  });

  it('returns EVzone defaults when runtime config is incomplete', async () => {
    controlPlane.organization.findFirst.mockResolvedValue({
      id: 'tenant-1',
      name: 'Acme Charge',
      logoUrl: null,
      tenantSubdomain: 'acme',
      primaryDomain: 'portal.acme.com',
      whiteLabelConfig: {
        schemaVersion: 1,
      },
      allowedOrigins: [],
    });

    const response = await service.getPublicRuntimeBranding({
      host: 'portal.acme.com',
      resolvedTenantId: null,
    });

    expect(response.resolvedBy).toBe('host_custom_domain');
    expect(response.config.branding.appName).toBe('EVzone CPO Central');
    expect(response.config.branding.shortName).toBe('EVzone');
  });

  it('supports direct branding asset URL input without file upload', async () => {
    controlPlane.user.findUnique.mockResolvedValue({
      role: UserRole.EVZONE_ADMIN,
    });

    const response = await service.uploadAssetForPlatformActor(
      'admin-1',
      'tenant-1',
      {
        assetKind: 'logo',
        assetUrl: 'https://cdn.acme.test/brand/logo.svg',
      },
    );

    expect(response.source).toBe('url');
    expect(response.assetUrl).toBe('https://cdn.acme.test/brand/logo.svg');
    expect(mediaStorage.uploadBuffer).not.toHaveBeenCalled();
    const auditCreateCalls = prisma.auditLog.create.mock.calls as Array<
      [{ data?: { action?: string } }]
    >;
    const assetAuditCall = auditCreateCalls.find(
      (call) => call[0]?.data?.action === 'BRANDING_ASSET_UPLOADED',
    );
    expect(assetAuditCall).toBeDefined();
  });
});

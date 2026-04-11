import { UnauthorizedException } from '@nestjs/common';
import { TenantContextService } from '@app/db';
import { PrismaService } from '../../prisma.service';
import { DeveloperPlatformService } from './developer-platform.service';

describe('DeveloperPlatformService', () => {
  const prisma = {
    developerApiKey: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    developerApiUsage: {
      aggregate: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
  };
  const tenantContext = {
    get: jest.fn(),
  };

  const service = new DeveloperPlatformService(
    prisma as unknown as PrismaService,
    tenantContext as unknown as TenantContextService,
  );

  beforeEach(() => {
    prisma.developerApiKey.findUnique.mockReset();
    prisma.developerApiKey.update.mockReset();
    prisma.developerApiUsage.aggregate.mockReset();
    prisma.developerApiUsage.update.mockReset();
    prisma.developerApiUsage.upsert.mockReset();
    prisma.auditLog.create.mockReset();
  });

  it('writes an audit event when a revoked developer API key is used', async () => {
    prisma.developerApiKey.findUnique.mockResolvedValue({
      id: 'key-1',
      appId: 'app-1',
      organizationId: 'org-1',
      keyPrefix: 'evz_revokedkey',
      secretHash: 'stored-hash',
      secretSalt: 'stored-salt',
      scopes: ['*'],
      rateLimitPerMin: 120,
      status: 'REVOKED',
      app: {
        id: 'app-1',
        status: 'ACTIVE',
        organizationId: 'org-1',
      },
    });
    prisma.auditLog.create.mockResolvedValue({});

    await expect(
      service.authenticateApiKey({
        rawApiKey: 'evz_revokedkey.secret',
        route: '/api/v1/developer/v1/stations/summary',
        method: 'GET',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const auditCalls = prisma.auditLog.create.mock.calls as Array<
      [
        {
          data: {
            actor?: string;
            action?: string;
            resource?: string;
            resourceId?: string;
            status?: string;
            errorMessage?: string;
            details?: Record<string, unknown>;
          };
        },
      ]
    >;
    const auditCall = auditCalls[0]?.[0];

    expect(auditCall?.data.actor).toBe('developer-api-key:evz_revokedkey');
    expect(auditCall?.data.action).toBe('DEVELOPER_API_KEY_AUTH_DENIED');
    expect(auditCall?.data.resource).toBe('DeveloperApiKey');
    expect(auditCall?.data.resourceId).toBe('key-1');
    expect(auditCall?.data.status).toBe('FAILURE');
    expect(auditCall?.data.errorMessage).toBe(
      'Developer API key authentication denied',
    );
    expect(auditCall?.data.details).toEqual(
      expect.objectContaining({
        keyPrefix: 'evz_revokedkey',
        organizationId: 'org-1',
        route: '/api/v1/developer/v1/stations/summary',
        method: 'GET',
        reason: 'KEY_NOT_ACTIVE',
        keyStatus: 'REVOKED',
        appStatus: 'ACTIVE',
      }),
    );
    expect(prisma.developerApiUsage.upsert).not.toHaveBeenCalled();
    expect(prisma.developerApiKey.update).not.toHaveBeenCalled();
  });
});

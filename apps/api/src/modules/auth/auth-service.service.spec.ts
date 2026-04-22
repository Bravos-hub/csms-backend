import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MembershipStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { MetricsService } from '../../common/services/metrics.service';
import { OcpiTokenSyncService } from '../../common/services/ocpi-token-sync.service';
import { NotificationService } from '../notification/notification-service.service';
import { MailService } from '../mail/mail.service';
import { AdminApprovalService } from './admin-approval.service';
import { AccessProfileService } from './access-profile.service';
import { AuthAnomalyMonitorService } from './auth-anomaly-monitor.service';
import {
  InviteUserDto,
  TeamInviteUserDto,
  UpdateUserDto,
} from './dto/auth.dto';
import { AuthService } from './auth-service.service';
import { TenantDirectoryService } from '../../common/tenant/tenant-directory.service';

type AuthServicePrivateTestHandle = AuthService & {
  ensureEvzoneOrganization: () => Promise<{ id: string }>;
  getTeamManagerScope: (actorId: string) => Promise<{
    organizationId: string | null;
    managerRole: UserRole;
  }>;
  ensureTeamMemberInScope: (
    targetUserId: string,
    actorId: string,
  ) => Promise<{
    id: string;
    ownerCapability: string | null;
  }>;
};

function createService() {
  const controlPlane = {
    platformRoleAssignment: {
      findFirst: jest.fn(),
    },
    organization: {
      findUnique: jest.fn(),
    },
  };
  const prisma = {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    organizationMembership: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    userInvitation: {
      updateMany: jest.fn(),
    },
    stationTeamAssignment: {
      findMany: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
    getControlPlaneClient: jest.fn(() => controlPlane),
    runWithTenantRouting: jest.fn(
      <T>(_routing: unknown, work: () => Promise<T>) => work(),
    ),
  };
  const config = {
    get: jest.fn(),
  };
  const metrics = {
    recordAuthMetric: jest.fn(),
  };
  const anomalyMonitor = {
    recordFailure: jest.fn(),
    recordSuccess: jest.fn(),
  };
  const ocpiTokenSync = {
    syncUserToken: jest.fn(),
  };

  const service = new AuthService(
    prisma as unknown as PrismaService,
    {} as NotificationService,
    {} as MailService,
    config as unknown as ConfigService,
    metrics as unknown as MetricsService,
    anomalyMonitor as unknown as AuthAnomalyMonitorService,
    ocpiTokenSync as unknown as OcpiTokenSyncService,
    {} as AdminApprovalService,
    new AccessProfileService(),
    {
      findByOrganizationId: jest.fn(),
      toRoutingHint: jest.fn(),
    } as unknown as TenantDirectoryService,
  );

  prisma.organizationMembership.findMany.mockResolvedValue([]);
  prisma.stationTeamAssignment.findMany.mockResolvedValue([]);

  return { service, prisma, controlPlane };
}

describe('AuthService EVZONE guardrails', () => {
  it('enforces EVZONE WORLD assignment for EVZONE roles', async () => {
    const { service, prisma } = createService();
    const authService = service as unknown as AuthServicePrivateTestHandle;
    jest
      .spyOn(authService, 'ensureEvzoneOrganization')
      .mockResolvedValue({ id: 'evzone-org' });
    const enforceEvzoneOrganizationAssignment = Reflect.get(
      service,
      'enforceEvzoneOrganizationAssignment',
    ) as (input: {
      userId: string;
      role: UserRole;
      membershipStatus?: MembershipStatus;
    }) => Promise<{ organizationId: string } | null>;

    const result = await enforceEvzoneOrganizationAssignment.call(service, {
      userId: 'user-1',
      role: UserRole.EVZONE_ADMIN,
      membershipStatus: MembershipStatus.ACTIVE,
    });

    expect(result).toEqual({ organizationId: 'evzone-org' });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { organizationId: 'evzone-org' },
    });
    expect(prisma.organizationMembership.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_organizationId: {
            userId: 'user-1',
            organizationId: 'evzone-org',
          },
        },
      }),
    );
  });

  it('does nothing for non-EVZONE roles', async () => {
    const { service, prisma } = createService();
    const authService = service as unknown as AuthServicePrivateTestHandle;
    const ensureSpy = jest.spyOn(authService, 'ensureEvzoneOrganization');
    const enforceEvzoneOrganizationAssignment = Reflect.get(
      service,
      'enforceEvzoneOrganizationAssignment',
    ) as (input: {
      userId: string;
      role: UserRole;
      membershipStatus?: MembershipStatus;
    }) => Promise<{ organizationId: string } | null>;

    const result = await enforceEvzoneOrganizationAssignment.call(service, {
      userId: 'user-2',
      role: UserRole.SITE_OWNER,
    });

    expect(result).toBeNull();
    expect(ensureSpy).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.organizationMembership.upsert).not.toHaveBeenCalled();
  });

  it('blocks non-platform actors from assigning EVZONE role in team invite', async () => {
    const { service } = createService();
    const authService = service as unknown as AuthServicePrivateTestHandle;
    jest.spyOn(authService, 'getTeamManagerScope').mockResolvedValue({
      organizationId: 'org-1',
      managerRole: UserRole.STATION_OWNER,
    });
    const inviteDto: TeamInviteUserDto = {
      email: 'invitee@evzone.app',
      role: UserRole.EVZONE_OPERATOR,
    };

    await expect(
      service.inviteTeamMember(inviteDto, 'actor-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('blocks non-platform actors from assigning EVZONE role in team member update', async () => {
    const { service } = createService();
    const authService = service as unknown as AuthServicePrivateTestHandle;
    jest.spyOn(authService, 'getTeamManagerScope').mockResolvedValue({
      organizationId: 'org-1',
      managerRole: UserRole.STATION_OWNER,
    });
    jest.spyOn(authService, 'ensureTeamMemberInScope').mockResolvedValue({
      id: 'target-1',
      ownerCapability: null,
    });
    const updateDto: UpdateUserDto = { role: UserRole.EVZONE_ADMIN };

    await expect(
      service.updateTeamMember('target-1', updateDto, 'actor-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('blocks non-platform actors from assigning EVZONE role in invite flow', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue({
      id: 'inviter-1',
      role: UserRole.STATION_OWNER,
      organizationId: 'org-1',
      zoneId: null,
      region: null,
      country: null,
    });

    const inviteDto: InviteUserDto = {
      email: 'invitee@evzone.app',
      role: UserRole.EVZONE_ADMIN,
    };

    await expect(
      service.inviteUser(inviteDto, 'inviter-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects non-EVZONE invites when inviter has no organization', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue({
      id: 'inviter-1',
      role: UserRole.STATION_OWNER,
      organizationId: null,
      zoneId: null,
      region: null,
      country: null,
    });

    const inviteDto: InviteUserDto = {
      email: 'invitee@evzone.app',
      role: UserRole.STATION_OWNER,
    };

    await expect(
      service.inviteUser(inviteDto, 'inviter-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('passes inviter organization guard when inviter has an organization', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue({
      id: 'inviter-1',
      role: UserRole.STATION_OWNER,
      organizationId: 'org-1',
      zoneId: null,
      region: null,
      country: null,
    });
    prisma.user.findFirst.mockResolvedValue({
      id: 'existing-user',
      email: 'existing@evzone.app',
      name: 'Existing User',
      country: null,
      region: null,
      zoneId: null,
      organizationId: 'org-1',
      status: 'Active',
    });
    prisma.organizationMembership.findUnique.mockResolvedValue({
      id: 'membership-1',
      status: MembershipStatus.ACTIVE,
    });

    const inviteDto: InviteUserDto = {
      email: 'existing@evzone.app',
      role: UserRole.STATION_OWNER,
    };

    await expect(
      service.inviteUser(inviteDto, 'inviter-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects generic user role updates', async () => {
    const { service, prisma } = createService();
    const updateDto: UpdateUserDto = { role: UserRole.EVZONE_ADMIN };

    await expect(
      service.updateUser('user-1', updateDto),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('keeps platform users in platform scope when tenant impersonation is cleared', async () => {
    const { service, prisma, controlPlane } = createService();
    const authService = service as unknown as AuthService & {
      generateAuthResponse: (
        user: unknown,
        options?: Record<string, unknown>,
      ) => Promise<unknown>;
      recordAuditEvent: (payload: unknown) => Promise<void>;
    };

    prisma.user.findUnique.mockResolvedValue({
      id: 'platform-user-1',
      role: UserRole.SUPER_ADMIN,
      organizationId: 'org-home',
      ownerCapability: null,
      name: 'Platform Admin',
      email: 'platform@evzone.io',
      phone: null,
      status: 'Active',
      providerId: null,
      lastStationAssignmentId: null,
      mustChangePassword: false,
      mfaRequired: false,
      region: null,
      zoneId: null,
      organization: null,
    });
    prisma.organizationMembership.findMany.mockResolvedValue([]);
    controlPlane.platformRoleAssignment.findFirst.mockResolvedValue({
      roleKey: 'PLATFORM_SUPER_ADMIN',
    });

    const generateAuthResponseSpy = jest
      .spyOn(authService, 'generateAuthResponse')
      .mockResolvedValue({ accessToken: 'token' });
    const recordAuditEventSpy = jest
      .spyOn(authService, 'recordAuditEvent')
      .mockResolvedValue();

    const response = await service.switchTenant(
      'platform-user-1',
      null,
      'Maintenance scope complete',
    );

    expect(response).toEqual({ accessToken: 'token' });
    expect(generateAuthResponseSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'platform-user-1' }),
      expect.objectContaining({
        sessionScopeType: 'platform',
        actingAsTenant: false,
        selectedTenantId: null,
      }),
    );
    expect(recordAuditEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'TENANT_IMPERSONATION_CLEARED',
      }),
    );
    const clearedAuditPayload = recordAuditEventSpy.mock.calls[0]?.[0] as {
      details?: { actionType?: string; reason?: string };
    };
    expect(clearedAuditPayload.details?.actionType).toBe('STOP_IMPERSONATION');
    expect(clearedAuditPayload.details?.reason).toBe(
      'Maintenance scope complete',
    );
  });

  it('issues tenant impersonation session for platform users when tenant exists', async () => {
    const { service, prisma, controlPlane } = createService();
    const authService = service as unknown as AuthService & {
      generateAuthResponse: (
        user: unknown,
        options?: Record<string, unknown>,
      ) => Promise<unknown>;
      recordAuditEvent: (payload: unknown) => Promise<void>;
    };

    prisma.user.findUnique.mockResolvedValue({
      id: 'platform-user-1',
      role: UserRole.SUPER_ADMIN,
      organizationId: 'org-home',
      ownerCapability: null,
      name: 'Platform Admin',
      email: 'platform@evzone.io',
      phone: null,
      status: 'Active',
      providerId: null,
      lastStationAssignmentId: null,
      mustChangePassword: false,
      mfaRequired: false,
      region: null,
      zoneId: null,
      organization: null,
    });
    prisma.organizationMembership.findMany.mockResolvedValue([]);
    controlPlane.platformRoleAssignment.findFirst.mockResolvedValue({
      roleKey: 'PLATFORM_SUPER_ADMIN',
    });
    controlPlane.organization.findUnique.mockResolvedValue({
      id: 'tenant-1',
      name: 'Tenant One',
      suspendedAt: null,
    });

    const generateAuthResponseSpy = jest
      .spyOn(authService, 'generateAuthResponse')
      .mockResolvedValue({ accessToken: 'tenant-token' });
    const recordAuditEventSpy = jest
      .spyOn(authService, 'recordAuditEvent')
      .mockResolvedValue();

    const response = await service.switchTenant(
      'platform-user-1',
      'tenant-1',
      'Investigating tenant incident',
    );

    expect(response).toEqual({ accessToken: 'tenant-token' });
    expect(generateAuthResponseSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'platform-user-1' }),
      expect.objectContaining({
        sessionScopeType: 'tenant',
        actingAsTenant: true,
        selectedTenantId: 'tenant-1',
        selectedTenantName: 'Tenant One',
      }),
    );
    expect(recordAuditEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'TENANT_IMPERSONATION_STARTED',
      }),
    );
    const startedAuditPayload = recordAuditEventSpy.mock.calls[0]?.[0] as {
      details?: {
        actionType?: string;
        reason?: string;
        tenantId?: string;
        tenantName?: string;
      };
    };
    expect(startedAuditPayload.details?.actionType).toBe('START_IMPERSONATION');
    expect(startedAuditPayload.details?.reason).toBe(
      'Investigating tenant incident',
    );
    expect(startedAuditPayload.details?.tenantId).toBe('tenant-1');
    expect(startedAuditPayload.details?.tenantName).toBe('Tenant One');
  });
});

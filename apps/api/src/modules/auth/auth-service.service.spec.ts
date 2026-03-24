import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { MembershipStatus, UserRole } from '@prisma/client';
import { AuthService } from './auth-service.service';

function createService() {
  const prisma = {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    organizationMembership: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    userInvitation: {
      updateMany: jest.fn(),
    },
  } as any;

  const service = new AuthService(
    prisma,
    {} as any,
    {} as any,
    { get: jest.fn() } as any,
    { recordAuthMetric: jest.fn() } as any,
    { recordFailure: jest.fn(), recordSuccess: jest.fn() } as any,
    { syncUserToken: jest.fn() } as any,
    {} as any,
  );

  return { service, prisma };
}

describe('AuthService EVZONE guardrails', () => {
  it('enforces EVZONE WORLD assignment for EVZONE roles', async () => {
    const { service, prisma } = createService();
    jest
      .spyOn(service as any, 'ensureEvzoneOrganization')
      .mockResolvedValue({ id: 'evzone-org' });

    const result = await (service as any).enforceEvzoneOrganizationAssignment({
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
    const ensureSpy = jest.spyOn(service as any, 'ensureEvzoneOrganization');

    const result = await (service as any).enforceEvzoneOrganizationAssignment({
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
    jest.spyOn(service as any, 'getTeamManagerScope').mockResolvedValue({
      organizationId: 'org-1',
      managerRole: UserRole.STATION_OWNER,
    });

    await expect(
      service.inviteTeamMember(
        {
          email: 'invitee@evzone.app',
          role: UserRole.EVZONE_OPERATOR,
        } as any,
        'actor-1',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('blocks non-platform actors from assigning EVZONE role in team member update', async () => {
    const { service } = createService();
    jest.spyOn(service as any, 'getTeamManagerScope').mockResolvedValue({
      organizationId: 'org-1',
      managerRole: UserRole.STATION_OWNER,
    });
    jest.spyOn(service as any, 'ensureTeamMemberInScope').mockResolvedValue({
      id: 'target-1',
      ownerCapability: null,
    });

    await expect(
      service.updateTeamMember(
        'target-1',
        { role: UserRole.EVZONE_ADMIN } as any,
        'actor-1',
      ),
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

    await expect(
      service.inviteUser(
        {
          email: 'invitee@evzone.app',
          role: UserRole.EVZONE_ADMIN,
        } as any,
        'inviter-1',
      ),
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

    await expect(
      service.inviteUser(
        {
          email: 'invitee@evzone.app',
          role: UserRole.STATION_OWNER,
        } as any,
        'inviter-1',
      ),
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

    await expect(
      service.inviteUser(
        {
          email: 'existing@evzone.app',
          role: UserRole.STATION_OWNER,
        } as any,
        'inviter-1',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects generic user role updates', async () => {
    const { service, prisma } = createService();

    await expect(
      service.updateUser('user-1', { role: UserRole.EVZONE_ADMIN } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

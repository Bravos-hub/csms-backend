import {
  Injectable,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import {
  InvitationStatus,
  MembershipStatus,
  Prisma,
  StationOwnerCapability,
  UserRole,
} from '@prisma/client';
import {
  LoginDto,
  CreateUserDto,
  UpdateUserDto,
  InviteUserDto,
} from './dto/auth.dto';
import { NotificationService } from '../notification/notification-service.service';
import { MailService } from '../mail/mail.service';
import { AdminApprovalService } from './admin-approval.service';
import { ConfigService } from '@nestjs/config';
import { MetricsService } from '../../common/services/metrics.service';
import { OcpiTokenSyncService } from '../../common/services/ocpi-token-sync.service';
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import { SignOptions } from 'jsonwebtoken';
import * as bcrypt from 'bcrypt';
import * as qrcode from 'qrcode';
import * as speakeasy from 'speakeasy';
import { parsePaginationOptions } from '../../common/utils/pagination';
import {
  AuthAnomalyMonitorService,
  AuthMonitoringContext,
} from './auth-anomaly-monitor.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly invitationTtlMs = 7 * 24 * 60 * 60 * 1000;
  private readonly consistencyCounters = {
    registerValidationFailures: 0,
    inviteValidationFailures: 0,
    usersMissingOrganization: 0,
  };
  private readonly evzoneRoles = new Set<UserRole>([
    UserRole.SUPER_ADMIN,
    UserRole.EVZONE_ADMIN,
    UserRole.EVZONE_OPERATOR,
  ]);
  private readonly organizationSafeSelect = {
    id: true,
    name: true,
    type: true,
    city: true,
    address: true,
    logoUrl: true,
  } as const;
  private readonly userSafeSelect = {
    id: true,
    name: true,
    email: true,
    phone: true,
    role: true,
    providerId: true,
    status: true,
    country: true,
    region: true,
    postalCode: true,
    zoneId: true,
    subscribedPackage: true,
    organizationId: true,
    ownerCapability: true,
    mustChangePassword: true,
    createdAt: true,
    updatedAt: true,
  } as const;
  private readonly membershipSummarySelect = {
    id: true,
    organizationId: true,
    role: true,
    ownerCapability: true,
    status: true,
    organization: {
      select: {
        id: true,
        name: true,
        type: true,
      },
    },
  } as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly mailService: MailService,
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
    private readonly anomalyMonitor: AuthAnomalyMonitorService,
    private readonly ocpiTokenSync: OcpiTokenSyncService,
    private readonly approvalService: AdminApprovalService,
  ) {}

  getHello(): string {
    return 'Auth Service Operational';
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private generateOpaqueToken(bytes: number = 32): string {
    return crypto.randomBytes(bytes).toString('base64url');
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private generateTemporaryPassword(length: number = 14): string {
    const alphabet =
      'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
    const random = crypto.randomBytes(length);
    return Array.from(random)
      .map((value) => alphabet[value % alphabet.length])
      .join('');
  }

  private async recordAuditEvent(input: {
    actor: string;
    action: string;
    resource: string;
    resourceId?: string;
    details?: Prisma.InputJsonValue;
    status?: string;
    errorMessage?: string;
  }) {
    try {
      await this.prisma.auditLog.create({
        data: {
          actor: input.actor,
          action: input.action,
          resource: input.resource,
          resourceId: input.resourceId,
          details: input.details,
          status: input.status || 'SUCCESS',
          errorMessage: input.errorMessage,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to record audit event ${input.action}`,
        String(error).replace(/[\n\r]/g, ''),
      );
    }
  }

  private toRoleLabel(role: string): string {
    const roleLabels: Record<string, string> = {
      SUPER_ADMIN: 'Super Admin',
      EVZONE_ADMIN: 'EVzone Admin',
      EVZONE_OPERATOR: 'EVzone Operations',
      STATION_OPERATOR: 'Station Operator',
      SITE_OWNER: 'Site Owner',
      STATION_ADMIN: 'Station Admin',
      MANAGER: 'Manager',
      ATTENDANT: 'Attendant',
      CASHIER: 'Cashier',
      STATION_OWNER: 'Station Owner',
      SWAP_PROVIDER_ADMIN: 'Swap Provider Admin',
      SWAP_PROVIDER_OPERATOR: 'Swap Provider Operator',
      TECHNICIAN_ORG: 'Technician (Org)',
      TECHNICIAN_PUBLIC: 'Technician (Public)',
    };

    return roleLabels[role] || role;
  }

  private isEvzoneRole(role: UserRole | string | undefined): role is UserRole {
    if (!role) return false;
    return this.evzoneRoles.has(role as UserRole);
  }

  private normalizeRegionValue(region?: string | null): string | null {
    if (!region) return null;
    const normalized = region
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, '_');
    return normalized || null;
  }

  private incrementConsistencyCounter(
    key: keyof typeof this.consistencyCounters,
    reason: string,
    context: string,
  ) {
    this.consistencyCounters[key] += 1;
    this.logger.warn(
      `[consistency] ${context}: ${reason} (counter=${key}, total=${this.consistencyCounters[key]})`,
    );
  }

  private async ensureEvzoneOrganization(
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    const existing = await client.organization.findFirst({
      where: { name: { equals: 'EVZONE', mode: 'insensitive' } },
    });
    if (existing) return existing;

    return client.organization.create({
      data: {
        name: 'EVZONE',
        type: 'COMPANY',
        description: 'Default EVZONE platform organization',
      },
    });
  }

  private async resolveGeography(
    input: {
      zoneId?: string | null;
      region?: string | null;
      country?: string | null;
    },
    context: 'register' | 'invite',
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ): Promise<{ zoneId: string | null; region: string }> {
    if (input.zoneId) {
      const zone = await client.geographicZone.findUnique({
        where: { id: input.zoneId },
      });
      if (!zone) {
        this.incrementConsistencyCounter(
          context === 'register'
            ? 'registerValidationFailures'
            : 'inviteValidationFailures',
          `invalid zoneId=${input.zoneId}`,
          context,
        );
        throw new BadRequestException('Invalid zoneId: zone was not found');
      }

      return {
        zoneId: zone.id,
        region:
          this.normalizeRegionValue(input.region) ||
          this.normalizeRegionValue(zone.name) ||
          'UNKNOWN',
      };
    }

    const candidates = [input.region, input.country]
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value));

    for (const candidate of candidates) {
      const zone = await client.geographicZone.findFirst({
        where: {
          OR: [
            { code: { equals: candidate, mode: 'insensitive' } },
            { name: { equals: candidate, mode: 'insensitive' } },
          ],
        },
      });

      if (zone) {
        return {
          zoneId: zone.id,
          region:
            this.normalizeRegionValue(input.region) ||
            this.normalizeRegionValue(zone.name) ||
            'UNKNOWN',
        };
      }
    }

    if (context === 'invite') {
      return {
        zoneId: null,
        region:
          this.normalizeRegionValue(input.region) ||
          this.normalizeRegionValue(input.country) ||
          'UNKNOWN',
      };
    }

    this.incrementConsistencyCounter(
      context === 'register'
        ? 'registerValidationFailures'
        : 'inviteValidationFailures',
      `unresolved geography (region=${input.region || 'n/a'}, country=${input.country || 'n/a'})`,
      context,
    );
    throw new BadRequestException(
      'Unable to resolve geography. Provide a valid zoneId or a region/country that maps to a configured geographic zone.',
    );
  }

  private async getActiveMemberships(
    userId: string,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    return client.organizationMembership.findMany({
      where: {
        userId,
        status: MembershipStatus.ACTIVE,
      },
      orderBy: { createdAt: 'asc' },
      select: this.membershipSummarySelect,
    });
  }

  private resolveActiveOrganizationId(
    activeMemberships: Array<{ organizationId: string }>,
    fallbackOrganizationId?: string | null,
    preferredOrganizationId?: string | null,
  ): string | null {
    if (preferredOrganizationId) {
      const preferred = activeMemberships.find(
        (membership) => membership.organizationId === preferredOrganizationId,
      );
      if (preferred) return preferred.organizationId;
    }

    if (fallbackOrganizationId) {
      const fallback = activeMemberships.find(
        (membership) => membership.organizationId === fallbackOrganizationId,
      );
      if (fallback) return fallback.organizationId;
    }

    if (activeMemberships.length > 0) {
      return activeMemberships[0].organizationId;
    }

    return fallbackOrganizationId || null;
  }

  private resolveEffectiveRole(
    user: {
      role: UserRole;
    },
    activeMemberships: Array<{ organizationId: string; role: UserRole }>,
    activeOrganizationId: string | null,
  ): UserRole {
    if (!activeOrganizationId) {
      return user.role;
    }

    const membership = activeMemberships.find(
      (item) => item.organizationId === activeOrganizationId,
    );

    return membership?.role || user.role;
  }

  private async syncLegacyOrganizationId(
    userId: string,
    currentOrganizationId: string | null | undefined,
    activeOrganizationId: string | null,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    if (
      !activeOrganizationId ||
      currentOrganizationId === activeOrganizationId
    ) {
      return;
    }

    await client.user.update({
      where: { id: userId },
      data: { organizationId: activeOrganizationId },
    });
  }

  private async resolveInvitationByToken(
    token: string,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    const tokenHash = this.hashToken(token);
    const invitation = await client.userInvitation.findUnique({
      where: { tokenHash },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!invitation) {
      throw new BadRequestException('Invitation is invalid');
    }

    if (invitation.status === InvitationStatus.REVOKED) {
      throw new BadRequestException('Invitation has been revoked');
    }

    if (invitation.status === InvitationStatus.ACTIVATED) {
      throw new BadRequestException('Invitation has already been used');
    }

    if (invitation.expiresAt <= new Date()) {
      if (
        invitation.status === InvitationStatus.PENDING ||
        invitation.status === InvitationStatus.ACCEPTED
      ) {
        await client.userInvitation.update({
          where: { id: invitation.id },
          data: { status: InvitationStatus.EXPIRED },
        });
      }
      throw new BadRequestException('Invitation has expired');
    }

    if (invitation.status === InvitationStatus.EXPIRED) {
      throw new BadRequestException('Invitation has expired');
    }

    return invitation;
  }

  async login(loginDto: LoginDto, context?: AuthMonitoringContext) {
    const startTime = Date.now();
    const monitoringContext = this.createMonitoringContext(
      context,
      'login',
      loginDto.email,
    );
    try {
      const normalizedEmail = this.normalizeEmail(loginDto.email);
      this.logger.log(`Login attempt for ${normalizedEmail}`);
      let user = await this.prisma.user.findFirst({
        where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
      });
      if (!user) {
        throw new UnauthorizedException('Invalid credentials');
      }

      if (!user.passwordHash) {
        throw new UnauthorizedException('Invalid credentials');
      }

      const isPasswordValid = await bcrypt.compare(
        loginDto.password,
        user.passwordHash,
      );
      if (!isPasswordValid) {
        throw new UnauthorizedException('Invalid credentials');
      }

      let preferredOrganizationId: string | undefined;
      if (loginDto.inviteToken) {
        const activation = await this.activateInvitationOnLogin({
          userId: user.id,
          inviteToken: loginDto.inviteToken,
          loginPassword: loginDto.password,
        });
        preferredOrganizationId = activation.organizationId;

        user = await this.prisma.user.findUnique({
          where: { id: user.id },
        });

        if (!user) {
          throw new UnauthorizedException('User not found');
        }
      }

      // Check for awaiting approval status if not handled by frontend
      if (user.status === 'AwaitingApproval') {
        this.logger.log(`User ${user.email} is awaiting approval`);
        // We still return the user/token so frontend can redirect,
        // OR we can throw a specific error.
        // For now, let's allow it but log it (frontend handles the redirect)
      }

      // Auto-activate Super Admin on successful login if not already active
      if (user.role === UserRole.SUPER_ADMIN && user.status !== 'Active') {
        this.logger.log(`Auto-activating Super Admin: ${user.email}`);
        await this.prisma.user.update({
          where: { id: user.id },
          data: { status: 'Active' },
        });
        user.status = 'Active';
      }

      const response = await this.generateAuthResponse(user, {
        preferredOrganizationId,
      });
      this.anomalyMonitor.recordSuccess(monitoringContext);
      return response;
    } catch (error) {
      this.logger.error(
        `Login error for ${loginDto.email}: ${error.message}`,
        error.stack,
      );
      this.anomalyMonitor.recordFailure(
        monitoringContext,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  private async activateInvitationOnLogin(input: {
    userId: string;
    inviteToken: string;
    loginPassword: string;
  }): Promise<{ organizationId: string; usedTempPassword: boolean }> {
    const activation = await this.prisma.$transaction(async (tx) => {
      const invitation = await this.resolveInvitationByToken(
        input.inviteToken,
        tx,
      );
      const user = await tx.user.findUnique({
        where: { id: input.userId },
      });

      if (!user || !user.email) {
        throw new UnauthorizedException('Invalid credentials');
      }

      if (invitation.userId && invitation.userId !== user.id) {
        throw new BadRequestException('Invitation does not match this account');
      }

      if (
        this.normalizeEmail(invitation.email) !==
        this.normalizeEmail(user.email)
      ) {
        throw new BadRequestException(
          'Invitation email does not match authenticated account',
        );
      }

      let usedTempPassword = false;
      if (invitation.tempPasswordHash) {
        usedTempPassword = await bcrypt.compare(
          input.loginPassword,
          invitation.tempPasswordHash,
        );
      }

      await tx.organizationMembership.upsert({
        where: {
          userId_organizationId: {
            userId: user.id,
            organizationId: invitation.organizationId,
          },
        },
        create: {
          userId: user.id,
          organizationId: invitation.organizationId,
          role: invitation.role,
          ownerCapability: invitation.ownerCapability,
          status: MembershipStatus.ACTIVE,
          invitedBy: invitation.invitedBy || undefined,
        },
        update: {
          role: invitation.role,
          ownerCapability: invitation.ownerCapability,
          status: MembershipStatus.ACTIVE,
          invitedBy: invitation.invitedBy || undefined,
        },
      });

      const now = new Date();
      await tx.userInvitation.update({
        where: { id: invitation.id },
        data: {
          userId: user.id,
          status: InvitationStatus.ACTIVATED,
          acceptedAt: invitation.acceptedAt || now,
          activatedAt: now,
        },
      });

      const updateData: Prisma.UserUpdateInput = {};
      if (!user.emailVerifiedAt) {
        updateData.emailVerifiedAt = now;
      }
      if (usedTempPassword) {
        updateData.mustChangePassword = true;
      }
      if (user.status === 'Invited' || user.status === 'Pending') {
        updateData.status = 'Active';
      }

      if (Object.keys(updateData).length > 0) {
        await tx.user.update({
          where: { id: user.id },
          data: updateData,
        });
      }

      await this.syncLegacyOrganizationId(
        user.id,
        user.organizationId,
        invitation.organizationId,
        tx,
      );

      return {
        invitationId: invitation.id,
        organizationId: invitation.organizationId,
        usedTempPassword,
      };
    });

    await this.recordAuditEvent({
      actor: input.userId,
      action: 'INVITE_ACTIVATED',
      resource: 'UserInvitation',
      resourceId: activation.invitationId,
      details: {
        organizationId: activation.organizationId,
      },
    });

    return {
      organizationId: activation.organizationId,
      usedTempPassword: activation.usedTempPassword,
    };
  }

  private async generateAuthResponse(
    user: any,
    options?: { preferredOrganizationId?: string },
  ) {
    const result = await this.issueTokens(user, options);

    this.metrics.recordAuthMetric({
      operation: 'login',
      success: true,
      duration: 0,
      userId: user.id,
      timestamp: new Date(),
    });

    return result;
  }

  async register(createUserDto: CreateUserDto & { frontendUrl?: string }) {
    const exists = await this.prisma.user.findUnique({
      where: { email: createUserDto.email },
    });
    if (exists) {
      if (exists.status === 'Pending') {
        const verificationToken = await this.generateEmailVerificationToken(
          exists.id,
        );
        try {
          await this.mailService.sendVerificationEmail(
            createUserDto.email,
            verificationToken,
            createUserDto.frontendUrl,
          );
        } catch (error) {
          this.logger.error(
            'Failed to send verification email',
            String(error).replace(/[\n\r]/g, ''),
          );
        }
        await this.syncOcpiTokenSafe(exists);
        return {
          success: true,
          message: 'Registration successful. Please check your email.',
        };
      }
      throw new BadRequestException('User already exists');
    }

    if (createUserDto.phone) {
      const phoneExists = await this.prisma.user.findUnique({
        where: { phone: createUserDto.phone },
      });
      if (phoneExists)
        throw new BadRequestException(
          'User with this phone number already exists',
        );
    }

    const hashedPassword = await bcrypt.hash(createUserDto.password, 10);
    const requestedRole =
      (createUserDto.role as UserRole) || UserRole.SITE_OWNER;

    // Registration Transaction
    const result = await this.prisma.$transaction(async (tx) => {
      const geography = await this.resolveGeography(
        {
          zoneId: createUserDto.zoneId,
          region: createUserDto.region,
          country: createUserDto.country,
        },
        'register',
        tx,
      );

      const orgType = createUserDto.accountType || 'COMPANY';
      const organization = this.isEvzoneRole(requestedRole)
        ? await this.ensureEvzoneOrganization(tx)
        : await tx.organization.create({
            data: {
              name:
                orgType === 'COMPANY'
                  ? createUserDto.companyName || `${createUserDto.name}'s Corp`
                  : createUserDto.companyName || createUserDto.name,
              type: orgType,
            },
          });

      // 2. Create User linked to Org
      const user = await tx.user.create({
        data: {
          email: createUserDto.email,
          name: createUserDto.name,
          phone: createUserDto.phone,
          role: requestedRole,
          status: 'Pending', // User starts as Pending (email not verified)
          passwordHash: hashedPassword,
          country: createUserDto.country,
          region: geography.region,
          zoneId: geography.zoneId,
          subscribedPackage: createUserDto.subscribedPackage || 'Free',
          ownerCapability: createUserDto.ownerCapability as any,
          organizationId: organization.id,
        },
      });

      await tx.organizationMembership.create({
        data: {
          userId: user.id,
          organizationId: organization.id,
          role: requestedRole,
          ownerCapability: createUserDto.ownerCapability as any,
          status: MembershipStatus.ACTIVE,
        },
      });

      // 3. Create User Application for Admin Approval
      await tx.userApplication.create({
        data: {
          userId: user.id,
          companyName: createUserDto.companyName,
          taxId: createUserDto.taxId,
          country: createUserDto.country || 'Unknown',
          region: geography.region,
          accountType: orgType,
          role: requestedRole,
          subscribedPackage: createUserDto.subscribedPackage,
          status: 'PENDING',
        },
      });

      return { user, organization };
    });

    await this.syncOcpiTokenSafe(result.user);

    try {
      const verificationToken = await this.generateEmailVerificationToken(
        result.user.id,
      );
      await this.mailService.sendVerificationEmail(
        createUserDto.email,
        verificationToken,
        createUserDto.frontendUrl,
      );
    } catch (error) {
      this.logger.error(
        'Failed to send verification email',
        String(error).replace(/[\n\r]/g, ''),
      );
    }

    return {
      success: true,
      message: 'Registration successful. Please check your email.',
      user: {
        id: result.user.id,
        email: result.user.email,
        organizationId: result.organization.id,
      },
    };
  }

  async inviteUser(inviteDto: InviteUserDto, inviterId?: string) {
    if (!inviterId) {
      throw new UnauthorizedException(
        'Authenticated inviter context is required',
      );
    }

    const inviter = await this.prisma.user.findUnique({
      where: { id: inviterId },
      select: {
        id: true,
        organizationId: true,
        zoneId: true,
        region: true,
        country: true,
      },
    });
    if (!inviter) {
      throw new NotFoundException('Inviter not found');
    }

    const normalizedEmail = this.normalizeEmail(inviteDto.email);

    const inviteRole = inviteDto.role as unknown as UserRole;
    const organizationId = this.isEvzoneRole(inviteRole)
      ? (await this.ensureEvzoneOrganization()).id
      : inviter.organizationId;

    if (!organizationId) {
      this.incrementConsistencyCounter(
        'inviteValidationFailures',
        `inviter ${inviter.id} has no organization for role ${inviteRole}`,
        'invite',
      );
      throw new BadRequestException(
        'Inviter is missing organization assignment; cannot invite non-EVZONE users',
      );
    }

    const existingUser = await this.prisma.user.findFirst({
      where: {
        email: { equals: normalizedEmail, mode: 'insensitive' },
      },
      select: {
        id: true,
        email: true,
        name: true,
        country: true,
        region: true,
        zoneId: true,
        organizationId: true,
        status: true,
      },
    });

    if (existingUser) {
      const existingActiveMembership =
        await this.prisma.organizationMembership.findUnique({
          where: {
            userId_organizationId: {
              userId: existingUser.id,
              organizationId,
            },
          },
          select: {
            id: true,
            status: true,
          },
        });

      if (existingActiveMembership?.status === MembershipStatus.ACTIVE) {
        throw new ConflictException(
          'User is already an active member of this organization',
        );
      }
    }

    await this.prisma.userInvitation.updateMany({
      where: {
        email: { equals: normalizedEmail, mode: 'insensitive' },
        organizationId,
        status: { in: [InvitationStatus.PENDING, InvitationStatus.ACCEPTED] },
      },
      data: {
        status: InvitationStatus.REVOKED,
      },
    });

    const inviteToken = this.generateOpaqueToken();
    const tokenHash = this.hashToken(inviteToken);
    const expiresAt = new Date(Date.now() + this.invitationTtlMs);

    const invitationResult = await this.prisma.$transaction(async (tx) => {
      let userId = existingUser?.id;
      let tempPassword: string | undefined;
      let tempPasswordHash: string | null = null;

      if (!existingUser) {
        const geography = await this.resolveGeography(
          {
            zoneId: inviteDto.zoneId || inviter.zoneId,
            region: inviteDto.region || inviter.region,
            country: inviter.country,
          },
          'invite',
          tx,
        );

        tempPassword = this.generateTemporaryPassword();
        tempPasswordHash = await bcrypt.hash(tempPassword, 10);

        const createdUser = await tx.user.create({
          data: {
            email: normalizedEmail,
            name: normalizedEmail.split('@')[0],
            role: inviteRole,
            status: 'Invited',
            passwordHash: tempPasswordHash,
            country: inviter.country,
            region: geography.region,
            zoneId: geography.zoneId,
            organizationId,
            ownerCapability:
              inviteDto.ownerCapability as unknown as StationOwnerCapability,
            mustChangePassword: false,
          },
          select: {
            id: true,
          },
        });

        userId = createdUser.id;
      }

      if (!userId) {
        throw new BadRequestException('Unable to resolve invited user');
      }

      await tx.organizationMembership.upsert({
        where: {
          userId_organizationId: {
            userId,
            organizationId,
          },
        },
        create: {
          userId,
          organizationId,
          role: inviteRole,
          ownerCapability:
            inviteDto.ownerCapability as unknown as StationOwnerCapability,
          status: MembershipStatus.INVITED,
          invitedBy: inviter.id,
        },
        update: {
          role: inviteRole,
          ownerCapability:
            inviteDto.ownerCapability as unknown as StationOwnerCapability,
          status: MembershipStatus.INVITED,
          invitedBy: inviter.id,
        },
      });

      const invitation = await tx.userInvitation.create({
        data: {
          email: normalizedEmail,
          userId,
          organizationId,
          role: inviteRole,
          ownerCapability:
            inviteDto.ownerCapability as unknown as StationOwnerCapability,
          invitedBy: inviter.id,
          tokenHash,
          status: InvitationStatus.PENDING,
          expiresAt,
          tempPasswordHash,
          tempPasswordIssuedAt: tempPassword ? new Date() : null,
        },
        select: {
          id: true,
        },
      });

      return {
        invitationId: invitation.id,
        tempPassword,
      };
    });

    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    });

    try {
      await this.mailService.sendInvitationEmail(
        normalizedEmail,
        this.toRoleLabel(inviteRole),
        organization?.name || 'EVZONE',
        inviteDto.frontendUrl,
        inviteToken,
        invitationResult.tempPassword,
      );
    } catch (error) {
      this.logger.error(
        'Failed to send invitation email',
        String(error).replace(/[\n\r]/g, ''),
      );
    }

    await this.recordAuditEvent({
      actor: inviter.id,
      action: 'INVITE_SENT',
      resource: 'UserInvitation',
      resourceId: invitationResult.invitationId,
      details: {
        email: normalizedEmail,
        organizationId,
        role: inviteRole,
        isExistingUser: Boolean(existingUser),
      },
    });

    return {
      success: true,
      inviteId: invitationResult.invitationId,
      expiresAt,
      isExistingUser: Boolean(existingUser),
    };
  }

  async acceptInvitationToken(token: string) {
    const inviteToken = token?.trim();
    if (!inviteToken) {
      throw new BadRequestException('Invitation token is required');
    }

    const invitation = await this.prisma.$transaction(async (tx) => {
      const resolved = await this.resolveInvitationByToken(inviteToken, tx);

      if (resolved.status === InvitationStatus.PENDING) {
        return tx.userInvitation.update({
          where: { id: resolved.id },
          data: {
            status: InvitationStatus.ACCEPTED,
            acceptedAt: new Date(),
          },
          include: {
            organization: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        });
      }

      return resolved;
    });

    await this.recordAuditEvent({
      actor: invitation.email,
      action: 'INVITE_ACCEPTED',
      resource: 'UserInvitation',
      resourceId: invitation.id,
      details: {
        organizationId: invitation.organizationId,
      },
    });

    return {
      email: invitation.email,
      organizationName: invitation.organization?.name || 'EVZONE',
      role: invitation.role,
      requiresTempPassword: Boolean(invitation.tempPasswordHash),
      inviteToken,
    };
  }

  async switchOrganization(userId: string, organizationId: string) {
    if (!userId) {
      throw new UnauthorizedException('Authenticated user context is required');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        organization: {
          select: this.organizationSafeSelect,
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    let membership = await this.prisma.organizationMembership.findUnique({
      where: {
        userId_organizationId: {
          userId,
          organizationId,
        },
      },
    });

    if (!membership && user.organizationId === organizationId) {
      membership = await this.prisma.organizationMembership.create({
        data: {
          userId,
          organizationId,
          role: user.role,
          ownerCapability: user.ownerCapability,
          status: MembershipStatus.ACTIVE,
        },
      });
    }

    if (!membership || membership.status !== MembershipStatus.ACTIVE) {
      throw new UnauthorizedException(
        'No active membership found for selected organization',
      );
    }

    if (user.organizationId !== organizationId) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { organizationId },
      });
      user.organizationId = organizationId;
    }

    await this.recordAuditEvent({
      actor: user.id,
      action: 'ORG_SWITCHED',
      resource: 'OrganizationMembership',
      resourceId: membership.id,
      details: {
        organizationId,
      },
    });

    return this.generateAuthResponse(user, {
      preferredOrganizationId: organizationId,
    });
  }

  async issueServiceToken(
    clientId: string,
    clientSecret: string,
    scope?: string,
    context?: AuthMonitoringContext,
  ) {
    const monitoringContext = this.createMonitoringContext(
      context,
      'service_token',
      clientId,
    );
    try {
      const serviceAccount = await this.prisma.serviceAccount.findUnique({
        where: { clientId },
      });

      if (!serviceAccount || serviceAccount.status !== 'ACTIVE') {
        throw new UnauthorizedException('Invalid or inactive service account');
      }

      const isValid = this.verifyServiceSecret(
        clientSecret,
        serviceAccount.secretSalt,
        serviceAccount.secretHash,
      );

      if (!isValid) {
        throw new UnauthorizedException('Invalid service credentials');
      }

      const requestedScopes = this.normalizeScopes(scope);
      const allowedScopes = this.normalizeScopes(serviceAccount.scopes);

      const payload = {
        sub: serviceAccount.id,
        clientId: serviceAccount.clientId,
        scopes: requestedScopes.length > 0 ? requestedScopes : allowedScopes,
        type: 'SERVICE',
      };

      const token = jwt.sign(
        payload,
        this.config.get<string>('JWT_SERVICE_SECRET') || 'dev_secret',
        {
          expiresIn:
            (this.config.get(
              'JWT_SERVICE_EXPIRY',
            ) as SignOptions['expiresIn']) || '1y',
          issuer: this.config.get('JWT_SERVICE_ISSUER'),
          audience: this.config.get('JWT_SERVICE_AUDIENCE'),
        },
      );

      this.anomalyMonitor.recordSuccess(monitoringContext);
      return {
        accessToken: token,
        expiresIn: this.config.get('JWT_SERVICE_EXPIRY') || '1y',
      };
    } catch (error) {
      this.anomalyMonitor.recordFailure(
        monitoringContext,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  async requestOtp(identifier: string, context?: AuthMonitoringContext) {
    const isEmail = identifier.includes('@');
    const monitoringContext = this.createMonitoringContext(
      context,
      'otp_send',
      identifier,
    );
    try {
      if (!identifier) throw new BadRequestException('Identifier required');

      let user = await this.prisma.user.findFirst({
        where: isEmail ? { email: identifier } : { phone: identifier },
      });

      if (!user) {
        if (isEmail) {
          throw new NotFoundException('User not found');
        }

        user = await this.prisma.user.create({
          data: { phone: identifier, name: 'Mobile User', status: 'Pending' },
        });

        await this.syncOcpiTokenSafe(user);
      }

      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const expires = new Date(Date.now() + 5 * 60 * 1000);

      await this.prisma.user.update({
        where: { id: user.id },
        data: { otpCode: code, otpExpiresAt: expires },
      });

      if (isEmail) {
        await this.mailService.sendMail(
          user.email!,
          'Verification OTP',
          `<p>Your OTP is <b>${code}</b></p>`,
        );
      } else {
        await this.notificationService.sendSms(
          identifier,
          `EvZone: Your verification code is ${code}`,
        );
      }

      this.anomalyMonitor.recordSuccess(monitoringContext);
      return { status: 'OTP Sent', identifier };
    } catch (error) {
      this.anomalyMonitor.recordFailure(
        monitoringContext,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  async verifyOtp(
    identifier: string,
    code: string,
    context?: AuthMonitoringContext,
  ) {
    const isEmail = identifier.includes('@');
    const monitoringContext = this.createMonitoringContext(
      context,
      'otp_verify',
      identifier,
    );
    try {
      const user = await this.prisma.user.findFirst({
        where: isEmail ? { email: identifier } : { phone: identifier },
      });
      if (!user) throw new UnauthorizedException('User not found');

      if (!user.otpCode || user.otpCode !== code) {
        throw new UnauthorizedException('Invalid OTP');
      }

      if (!user.otpExpiresAt || new Date() > user.otpExpiresAt) {
        throw new UnauthorizedException('OTP Expired');
      }

      const updatedUser = await this.prisma.user.update({
        where: { id: user.id },
        data: { status: 'Active', otpCode: null, otpExpiresAt: null },
      });

      await this.syncOcpiTokenSafe(updatedUser);
      this.anomalyMonitor.recordSuccess(monitoringContext);

      return this.issueTokens(updatedUser as any);
    } catch (error) {
      this.anomalyMonitor.recordFailure(
        monitoringContext,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  async resetPassword(
    identifier: string,
    code: string,
    newPassword: string,
    context?: AuthMonitoringContext,
  ) {
    const isEmail = identifier.includes('@');
    const monitoringContext = this.createMonitoringContext(
      context,
      'password_reset',
      identifier,
    );
    try {
      const user = await this.prisma.user.findFirst({
        where: isEmail ? { email: identifier } : { phone: identifier },
      });
      if (!user) throw new UnauthorizedException('User not found');

      if (!user.otpCode || !this.constantTimeCompare(user.otpCode, code)) {
        throw new UnauthorizedException('Invalid OTP');
      }

      if (!user.otpExpiresAt || new Date() > user.otpExpiresAt) {
        throw new UnauthorizedException('OTP Expired');
      }

      const hashedPassword = await bcrypt.hash(newPassword, 10);

      const updatedUser = await this.prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash: hashedPassword,
          otpCode: null,
          otpExpiresAt: null,
          status: 'Active',
          mustChangePassword: false,
        },
      });

      await this.syncOcpiTokenSafe(updatedUser);
      this.anomalyMonitor.recordSuccess(monitoringContext);

      return { success: true, message: 'Password reset successful' };
    } catch (error) {
      this.anomalyMonitor.recordFailure(
        monitoringContext,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  private async buildAuthUserContext(
    user: any,
    options?: { preferredOrganizationId?: string },
  ) {
    const activeMemberships = await this.getActiveMemberships(user.id);
    const memberships =
      activeMemberships.length > 0
        ? activeMemberships
        : user.organizationId
          ? (() => {
              const legacyOrganization = user.organization
                ? {
                    id: user.organization.id,
                    name: user.organization.name,
                    type: user.organization.type,
                  }
                : null;

              if (!legacyOrganization) {
                return [];
              }

              return [
                {
                  id: `legacy-${user.id}-${legacyOrganization.id}`,
                  organizationId: legacyOrganization.id,
                  role: user.role as UserRole,
                  ownerCapability:
                    (user.ownerCapability as StationOwnerCapability | null) ||
                    null,
                  status: MembershipStatus.ACTIVE,
                  organization: legacyOrganization,
                },
              ];
            })()
          : [];

    const activeOrganizationId = this.resolveActiveOrganizationId(
      memberships,
      user.organizationId,
      options?.preferredOrganizationId,
    );
    const effectiveRole = this.resolveEffectiveRole(
      user,
      memberships.map((item) => ({
        organizationId: item.organizationId,
        role: item.role,
      })),
      activeOrganizationId,
    );

    await this.syncLegacyOrganizationId(
      user.id,
      user.organizationId,
      activeOrganizationId,
    );

    return {
      activeOrganizationId,
      effectiveRole,
      memberships: memberships.map((membership) => ({
        id: membership.id,
        organizationId: membership.organizationId,
        role: membership.role,
        ownerCapability: membership.ownerCapability || undefined,
        status: membership.status,
        organizationName: membership.organization?.name,
        organizationType: membership.organization?.type,
      })),
    };
  }

  private async issueTokens(
    user: any,
    options?: { preferredOrganizationId?: string },
  ) {
    const secret = this.config.get<string>('JWT_SECRET');
    if (!secret) {
      throw new Error('JWT_SECRET not configured');
    }

    const context = await this.buildAuthUserContext(user, options);

    const accessToken = jwt.sign(
      {
        sub: user.id,
        email: user.email,
        role: context.effectiveRole,
        organizationId: context.activeOrganizationId,
        activeOrganizationId: context.activeOrganizationId,
      },
      secret as jwt.Secret,
      {
        expiresIn: (this.config.get<string>('JWT_ACCESS_EXPIRY') ||
          '15m') as any,
      } as SignOptions,
    );

    const refreshToken = jwt.sign(
      { sub: user.id, type: 'refresh', jti: crypto.randomUUID() },
      secret as jwt.Secret,
      {
        expiresIn: this.config.get<string>('JWT_REFRESH_EXPIRY') || '7d',
      } as SignOptions,
    );

    const refreshExpiry = new Date();
    refreshExpiry.setDate(refreshExpiry.getDate() + 7);

    await this.prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt: refreshExpiry,
      },
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        role: context.effectiveRole,
        providerId: user.providerId,
        name: user.name,
        status: user.status,
        region: user.region,
        zoneId: user.zoneId,
        ownerCapability: user.ownerCapability,
        organizationId: context.activeOrganizationId || user.organizationId,
        orgId: context.activeOrganizationId || user.organizationId,
        activeOrganizationId: context.activeOrganizationId,
        memberships: context.memberships,
        mustChangePassword: Boolean(user.mustChangePassword),
      },
    };
  }

  async refresh(refreshToken: string, context?: AuthMonitoringContext) {
    const startTime = Date.now();
    const secret = this.config.get<string>('JWT_SECRET');
    const monitoringContext = this.createMonitoringContext(context, 'refresh');

    try {
      if (!secret) throw new Error('JWT_SECRET not configured');

      let payload: any;
      try {
        payload = jwt.verify(refreshToken, secret);
      } catch (error) {
        throw new UnauthorizedException('Invalid token');
      }

      const storedToken = await this.prisma.refreshToken.findFirst({
        where: {
          token: refreshToken,
          userId: payload.sub,
          expiresAt: { gt: new Date() },
          revokedAt: null,
        },
      });

      if (!storedToken)
        throw new UnauthorizedException('Token not found, expired, or revoked');

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
      });
      if (!user) throw new UnauthorizedException('User not found');
      const authUserContext = await this.buildAuthUserContext(user);

      const accessToken = jwt.sign(
        {
          sub: user.id,
          email: user.email,
          role: authUserContext.effectiveRole,
          organizationId: authUserContext.activeOrganizationId,
          activeOrganizationId: authUserContext.activeOrganizationId,
        },
        secret as jwt.Secret,
        {
          expiresIn: this.config.get<string>('JWT_ACCESS_EXPIRY') || '15m',
        } as SignOptions,
      );

      this.metrics.recordAuthMetric({
        operation: 'refresh',
        success: true,
        duration: Date.now() - startTime,
        userId: user.id,
        timestamp: new Date(),
      });
      this.anomalyMonitor.recordSuccess(monitoringContext);

      return {
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          email: user.email,
          phone: user.phone,
          role: authUserContext.effectiveRole,
          providerId: user.providerId,
          name: user.name,
          status: user.status,
          region: user.region,
          zoneId: user.zoneId,
          ownerCapability: user.ownerCapability,
          organizationId:
            authUserContext.activeOrganizationId || user.organizationId,
          orgId: authUserContext.activeOrganizationId || user.organizationId,
          activeOrganizationId: authUserContext.activeOrganizationId,
          memberships: authUserContext.memberships,
          mustChangePassword: Boolean(user.mustChangePassword),
        },
      };
    } catch (error) {
      this.metrics.recordAuthMetric({
        operation: 'refresh',
        success: false,
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date(),
      });
      this.anomalyMonitor.recordFailure(
        monitoringContext,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  getAuthAnomalySummary() {
    return this.anomalyMonitor.getSummary();
  }

  async revokeRefreshToken(token: string): Promise<void> {
    const startTime = Date.now();
    try {
      await this.prisma.refreshToken.updateMany({
        where: { token, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      this.metrics.recordAuthMetric({
        operation: 'logout',
        success: true,
        duration: Date.now() - startTime,
        timestamp: new Date(),
      });
    } catch (error) {
      this.metrics.recordAuthMetric({
        operation: 'logout',
        success: false,
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date(),
      });
    }
  }

  async findAllUsers(
    params: {
      search?: string;
      role?: string;
      status?: string;
      region?: string;
      zoneId?: string;
      orgId?: string;
      organizationId?: string;
      limit?: string;
      offset?: string;
    } = {},
  ) {
    const pagination = parsePaginationOptions(
      { limit: params.limit, offset: params.offset },
      { limit: 50, maxLimit: 200 },
    );

    const where: any = {};
    if (params.search) {
      where.OR = [
        { name: { contains: params.search, mode: 'insensitive' } },
        { email: { contains: params.search, mode: 'insensitive' } },
      ];
    }
    if (params.role) {
      where.role = params.role;
    }
    if (params.status) {
      where.status = params.status;
    }
    if (params.region) {
      where.region = {
        equals: this.normalizeRegionValue(params.region) || params.region,
        mode: 'insensitive',
      };
    }
    if (params.zoneId) {
      where.zoneId = params.zoneId;
    }
    if (params.orgId || params.organizationId) {
      const scopedOrgId = params.orgId || params.organizationId;
      where.AND = [
        ...(where.AND || []),
        {
          OR: [
            { organizationId: scopedOrgId },
            {
              memberships: {
                some: {
                  organizationId: scopedOrgId,
                  status: MembershipStatus.ACTIVE,
                },
              },
            },
          ],
        },
      ];
    }

    const users = await this.prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: pagination.limit,
      skip: pagination.offset,
      select: {
        ...this.userSafeSelect,
        organization: {
          select: this.organizationSafeSelect,
        },
        _count: {
          select: { ownedStations: true, operatedStations: true },
        },
      },
    });

    const missingOrg = users.filter(
      (user) => !user.organizationId && !this.isEvzoneRole(user.role),
    ).length;
    if (missingOrg > 0) {
      this.incrementConsistencyCounter(
        'usersMissingOrganization',
        `${missingOrg} users without organization in current /users result`,
        'list_users',
      );
    }

    return users;
  }

  async getCrmStats() {
    const total = await this.prisma.user.count();
    const active = await this.prisma.user.count({
      where: { status: 'Active' },
    });
    // Revenue mock (or sum transactions if possible)
    const totalRevenue = 125000;

    return {
      total,
      active,
      totalRevenue,
    };
  }

  async findUserById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        ...this.userSafeSelect,
        organization: {
          select: this.organizationSafeSelect,
        },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async getCurrentUser(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        ...this.userSafeSelect,
        organization: {
          select: this.organizationSafeSelect,
        },
        memberships: {
          where: {
            status: MembershipStatus.ACTIVE,
          },
          select: this.membershipSummarySelect,
        },
      },
    });

    if (!user) return null;

    const activeOrganizationId = this.resolveActiveOrganizationId(
      user.memberships,
      user.organizationId,
    );

    return {
      ...user,
      organizationId: activeOrganizationId || user.organizationId,
      orgId: activeOrganizationId || user.organizationId,
      activeOrganizationId,
      memberships: user.memberships.map((membership) => ({
        id: membership.id,
        organizationId: membership.organizationId,
        role: membership.role,
        ownerCapability: membership.ownerCapability,
        status: membership.status,
        organizationName: membership.organization?.name,
        organizationType: membership.organization?.type,
      })),
    };
  }

  async updateUser(id: string, updateDto: UpdateUserDto) {
    try {
      const updated = await this.prisma.user.update({
        where: { id },
        data: updateDto,
      });
      await this.syncOcpiTokenSafe(updated);
      return updated;
    } catch (error) {
      this.logger.error(
        `Failed to update user ${id}`,
        String(error).replace(/[\n\r]/g, ''),
      );
      throw new BadRequestException('Could not update user');
    }
  }

  async deleteUser(id: string) {
    return this.prisma.user.delete({ where: { id } });
  }

  private constantTimeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  }

  private async syncOcpiTokenSafe(user: any) {
    try {
      await this.ocpiTokenSync.syncUserToken(user);
    } catch (error) {
      this.logger.warn(
        'Failed to sync OCPI token for user',
        String(error).replace(/[\n\r]/g, ''),
      );
    }
  }

  private normalizeScopes(input: unknown): string[] {
    if (typeof input === 'string') {
      return input
        .split(' ')
        .map((v) => v.trim())
        .filter(Boolean);
    }
    if (Array.isArray(input)) {
      return input.map((v) => String(v).trim()).filter(Boolean);
    }
    return [];
  }

  private verifyServiceSecret(
    secret: string,
    salt: string,
    expectedHash: string,
  ): boolean {
    const hash = crypto.scryptSync(secret, salt, 64).toString('hex');
    const expected = Buffer.from(expectedHash, 'hex');
    const actual = Buffer.from(hash, 'hex');
    if (expected.length !== actual.length) return false;
    return crypto.timingSafeEqual(expected, actual);
  }

  private createMonitoringContext(
    context: AuthMonitoringContext | undefined,
    route: string,
    identifier?: string,
  ): AuthMonitoringContext {
    return {
      route,
      ip: context?.ip,
      userAgent: context?.userAgent,
      deviceId: context?.deviceId,
      identifier: identifier || context?.identifier,
    };
  }

  /**
   * Generate an email verification token
   */
  async generateEmailVerificationToken(
    userId: string,
    expiresIn: number = 86400000,
  ): Promise<string> {
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + expiresIn); // 24 hours by default

    await this.prisma.emailVerificationToken.create({
      data: {
        token,
        userId,
        expiresAt,
      },
    });

    this.logger.log(`Generated email verification token for user ${userId}`);
    return token;
  }

  /**
   * Verify an email verification token
   */
  async verifyEmailToken(
    token: string,
  ): Promise<{ userId: string; email: string }> {
    // Validate token format (must be a UUID)
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(token)) {
      throw new BadRequestException('Invalid verification token format');
    }

    const verificationToken =
      await this.prisma.emailVerificationToken.findUnique({
        where: { token },
        include: { user: true },
      });

    if (!verificationToken) {
      throw new BadRequestException('Invalid or expired verification token');
    }

    // Check if token has expired
    if (verificationToken.expiresAt < new Date()) {
      await this.prisma.emailVerificationToken.delete({
        where: { id: verificationToken.id },
      });
      throw new BadRequestException('Verification token has expired');
    }

    // Mark email as verified and update status to AwaitingApproval
    const user = await this.prisma.user.update({
      where: { id: verificationToken.userId },
      data: {
        emailVerifiedAt: new Date(),
        status: 'AwaitingApproval', // Move to approval stage after email verification
      },
    });

    // Delete the used token
    await this.prisma.emailVerificationToken.delete({
      where: { id: verificationToken.id },
    });

    // Send application received email
    try {
      if (user.email) {
        await this.mailService.sendApplicationReceivedEmail(
          user.email,
          user.name,
        );
      }
    } catch (error) {
      this.logger.error(
        'Failed to send application received email',
        String(error).replace(/[\n\r]/g, ''),
      );
    }

    this.logger.log(
      `Email verified for user ${user.id}, now awaiting admin approval`,
    );
    return { userId: user.id, email: user.email || '' };
  }

  /**
   * Resend verification email
   */
  async resendVerificationEmail(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.emailVerifiedAt) {
      throw new BadRequestException('Email is already verified');
    }

    // Delete any existing tokens for this user
    await this.prisma.emailVerificationToken.deleteMany({
      where: { userId: user.id },
    });

    // Generate new token
    const token = await this.generateEmailVerificationToken(user.id);

    // Send email
    try {
      await this.mailService.sendVerificationEmail(email, token);
    } catch (error) {
      this.logger.error(
        `Failed to send verification email to ${email}`,
        String(error).replace(/[\n\r]/g, ''),
      );
      throw new Error('Failed to send verification email');
    }
  }

  /**
   * Request a password reset for a user
   */
  async requestPasswordReset(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.email) {
      throw new NotFoundException('User not found or has no email');
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    await this.prisma.user.update({
      where: { id: userId },
      data: { otpCode: code, otpExpiresAt: expires },
    });

    try {
      await this.mailService.sendMail(
        user.email,
        'Password Reset Request',
        `<p>A password reset was requested for your account.</p>
         <p>Your reset code is: <b>${code}</b></p>
         <p>This code will expire in 15 minutes.</p>`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to send password reset email to ${user.email}`,
        error,
      );
      throw new Error('Failed to send password reset email');
    }
  }

  /**
   * Force logout a user by revoking all their refresh tokens
   */
  async forceLogoutUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    this.logger.log(`Forced logout for user ${userId}`);
  }

  /**
   * Update whether a user is required to use MFA
   */
  async toggleMfaRequirement(userId: string, required: boolean): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { status: required ? 'MfaRequired' : 'Active' },
    });
  }

  // 2FA Methods

  async generate2faSecret(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const appName = this.config.get<string>('APP_NAME') || 'EVzone';
    const secretObj = speakeasy.generateSecret({ name: appName });
    const secret = secretObj.base32;
    const otpauthUrl = secretObj.otpauth_url || '';

    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorSecret: secret },
    });

    const qrCodeUrl = await qrcode.toDataURL(otpauthUrl);
    return { qrCodeUrl, secret }; // Usually you don't return the secret, but nice for manual entry
  }

  async verify2faSetup(userId: string, token: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (!user.twoFactorSecret)
      throw new BadRequestException('2FA secret not generated');

    const isValid = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token,
    });
    if (!isValid) throw new BadRequestException('Invalid 2FA token');

    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: true },
    });

    return { success: true, message: '2FA enabled successfully' };
  }

  async disable2fa(userId: string, token: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (!user.twoFactorEnabled || !user.twoFactorSecret) {
      throw new BadRequestException('2FA is not enabled');
    }

    const isValid = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token,
    });
    if (!isValid) throw new BadRequestException('Invalid 2FA token');

    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: false, twoFactorSecret: null },
    });

    return { success: true, message: '2FA disabled successfully' };
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (!user.passwordHash)
      throw new BadRequestException('User does not have a password set');

    const isPasswordValid = await bcrypt.compare(
      currentPassword,
      user.passwordHash,
    );
    if (!isPasswordValid)
      throw new UnauthorizedException('Invalid current password');

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: hashedPassword, mustChangePassword: false },
    });

    try {
      if (user.email) {
        await this.mailService.sendMail(
          user.email,
          'Your Password Has Been Changed',
          `<p>Hello ${user.name},</p><p>Your password was successfully changed. If you did not make this change, please contact support immediately.</p>`,
        );
      }
    } catch (e) {
      this.logger.warn('Failed to send password change notification email', e);
    }

    return { success: true, message: 'Password changed successfully' };
  }
}

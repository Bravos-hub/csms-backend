import {
  Injectable,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import {
  InvitationStatus,
  MembershipStatus,
  Prisma,
  PasskeyCredential,
  PayoutMethod,
  CustomRoleStatus,
  StationOwnerCapability,
  AttendantRoleMode,
  User,
  UserRole,
} from '@prisma/client';
import {
  LoginDto,
  OtpChannel,
  PasskeyLoginOptionsDto,
  RegenerateRecoveryCodesDto,
  RemovePasskeyDto,
  CreateUserDto,
  UpdateUserDto,
  InviteUserDto,
  TeamInviteUserDto,
  TeamStationAssignmentDto,
  StaffPayoutProfileDto,
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
import {
  getCanonicalRoleDefinition,
  resolveCanonicalRoleKey,
  resolveRoleLabel,
  type AccessScopeType,
  type CanonicalRoleKey,
} from '@app/domain';
import { parsePaginationOptions } from '../../common/utils/pagination';
import {
  AuthAnomalyMonitorService,
  AuthMonitoringContext,
} from './auth-anomaly-monitor.service';
import {
  ActiveCustomRoleAccessSummary,
  AccessMembershipSummary,
  AccessProfileService,
  AccessStationContextSummary,
} from './access-profile.service';
import { TenantDirectoryService } from '../../common/tenant/tenant-directory.service';
import {
  type AuthenticatorAssertionResponseJSON,
  type AuthenticatorAttestationResponseJSON,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  type WebAuthnCredential,
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';

type AuthUserContextInput = Pick<
  User,
  | 'id'
  | 'email'
  | 'phone'
  | 'name'
  | 'status'
  | 'role'
  | 'providerId'
  | 'organizationId'
  | 'ownerCapability'
  | 'lastStationAssignmentId'
  | 'mustChangePassword'
  | 'mfaRequired'
  | 'twoFactorEnabled'
  | 'region'
  | 'zoneId'
> & {
  organization?: {
    id: string;
    name: string;
    type: string;
  } | null;
};

type MfaConfirmationInput = {
  twoFactorToken?: string;
  stepUpToken?: string;
  recoveryCode?: string;
};

type SessionScopeType = 'platform' | 'tenant';

type AuthSessionContextOptions = {
  preferredOrganizationId?: string | null;
  sessionScopeType?: SessionScopeType;
  actingAsTenant?: boolean;
  selectedTenantId?: string | null;
  selectedTenantName?: string | null;
};

type SessionTenantScopeOptions = Pick<
  AuthSessionContextOptions,
  'sessionScopeType' | 'actingAsTenant' | 'selectedTenantId'
>;

type AuthRefreshTokenClaims = jwt.JwtPayload & {
  sub: string;
  sessionScopeType?: SessionScopeType;
  actingAsTenant?: boolean;
  selectedTenantId?: string | null;
  selectedTenantName?: string | null;
};

type AuthSessionTokensResponse = {
  accessToken: string;
  refreshToken: string;
  user: Record<string, unknown>;
};

type OtpDeliveryChannel = OtpChannel.EMAIL | OtpChannel.SMS;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly invitationTtlMs = 7 * 24 * 60 * 60 * 1000;
  private readonly evzoneOrganizationName = 'EVZONE WORLD';
  private readonly legacyEvzoneOrganizationName = 'EVZONE';
  private readonly evzoneOrganizationLogoUrl =
    '/assets/EV zone Charging PNG Logo 2.png';
  private readonly evzoneOrganizationDescription =
    'Canonical organization for EVZONE WORLD platform ownership and operations.';
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
  private readonly teamManagerRoles = new Set<UserRole>([
    UserRole.SUPER_ADMIN,
    UserRole.EVZONE_ADMIN,
    UserRole.EVZONE_OPERATOR,
    UserRole.STATION_OWNER,
    UserRole.STATION_ADMIN,
    UserRole.STATION_OPERATOR,
  ]);
  private readonly teamManageableRoles = new Set<UserRole>([
    UserRole.SUPER_ADMIN,
    UserRole.EVZONE_ADMIN,
    UserRole.EVZONE_OPERATOR,
    UserRole.SWAP_PROVIDER_ADMIN,
    UserRole.SWAP_PROVIDER_OPERATOR,
    UserRole.SITE_OWNER,
    UserRole.STATION_OWNER,
    UserRole.STATION_OPERATOR,
    UserRole.STATION_ADMIN,
    UserRole.MANAGER,
    UserRole.ATTENDANT,
    UserRole.CASHIER,
    UserRole.TECHNICIAN_ORG,
    UserRole.TECHNICIAN_PUBLIC,
  ]);
  private readonly stationScopedTeamRoles = new Set<UserRole>([
    UserRole.STATION_OPERATOR,
    UserRole.STATION_ADMIN,
    UserRole.MANAGER,
    UserRole.ATTENDANT,
    UserRole.CASHIER,
  ]);
  private readonly defaultAttendantTimezone = 'Africa/Kampala';
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
    twoFactorEnabled: true,
    mfaRequired: true,
    mustChangePassword: true,
    lastStationAssignmentId: true,
    createdAt: true,
    updatedAt: true,
  } as const;
  private readonly membershipSummarySelect = {
    id: true,
    organizationId: true,
    role: true,
    canonicalRoleKey: true,
    customRoleId: true,
    customRoleName: true,
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
  private readonly twoFactorSecretPrefix = 'enc:v1';
  private readonly twoFactorMaxFailures = 5;
  private readonly twoFactorFailureWindowMs = 10 * 60 * 1000;
  private readonly twoFactorLockMs = 15 * 60 * 1000;
  private readonly mfaChallengeTtlMs = 5 * 60 * 1000;
  private readonly stepUpTokenTtl = '10m';
  private readonly recoveryCodeCount = 8;
  private readonly passkeyMaxLabelLength = 64;
  private readonly twoFactorAttempts = new Map<
    string,
    { failures: number; lastFailedAt: number; lockedUntil: number }
  >();
  private readonly webauthnPurposes = {
    passkeyRegistration: 'PASSKEY_REGISTRATION',
    passkeyLogin: 'PASSKEY_LOGIN',
    passkeyStepUp: 'PASSKEY_STEP_UP',
  } as const;
  private readonly supportedAuthenticatorTransports =
    new Set<AuthenticatorTransportFuture>([
      'ble',
      'cable',
      'hybrid',
      'internal',
      'nfc',
      'smart-card',
      'usb',
    ]);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly mailService: MailService,
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
    private readonly anomalyMonitor: AuthAnomalyMonitorService,
    private readonly ocpiTokenSync: OcpiTokenSyncService,
    private readonly approvalService: AdminApprovalService,
    private readonly accessProfileService: AccessProfileService,
    private readonly tenantDirectory: TenantDirectoryService,
  ) {}

  getHello(): string {
    return 'Auth Service Operational';
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private resolveLoginIdentifiers(loginDto: LoginDto): {
    email?: string;
    phone?: string;
  } {
    const rawEmail = loginDto.email?.trim();
    const rawPhone = loginDto.phone?.trim();

    // Accept identifier payload mismatches from older/frontline clients.
    const inferredEmail =
      !rawEmail && rawPhone && rawPhone.includes('@') ? rawPhone : undefined;
    const inferredPhone =
      !rawPhone && rawEmail && !rawEmail.includes('@') ? rawEmail : undefined;

    const emailCandidate = rawEmail || inferredEmail;
    const phoneCandidate =
      rawPhone && !rawPhone.includes('@') ? rawPhone : inferredPhone;

    return {
      email: emailCandidate ? this.normalizeEmail(emailCandidate) : undefined,
      phone: phoneCandidate || undefined,
    };
  }

  private async findUserForLogin(
    email?: string,
    phone?: string,
  ): Promise<User | null> {
    let user = await this.prisma.user.findFirst({
      where:
        email && phone
          ? {
              OR: [
                { email: { equals: email, mode: 'insensitive' } },
                { phone },
              ],
            }
          : email
            ? { email: { equals: email, mode: 'insensitive' } }
            : phone
              ? { phone }
              : undefined,
    });

    if (!user && email) {
      try {
        const emailFallback = await this.prisma.$queryRaw<{ id: string }[]>`
          SELECT "id"
          FROM "users"
          WHERE LOWER(TRIM("email")) = LOWER(${email})
          LIMIT 1
        `;
        if (emailFallback[0]?.id) {
          user = await this.prisma.user.findUnique({
            where: { id: emailFallback[0].id },
          });
        }
      } catch (error) {
        this.logger.warn(
          `Login email fallback query failed: ${
            (error as Error).message || String(error)
          }`,
        );
      }
    }

    if (!user && phone) {
      try {
        const phoneFallback = await this.prisma.$queryRaw<{ id: string }[]>`
          SELECT "id"
          FROM "users"
          WHERE TRIM("phone") = ${phone}
          LIMIT 1
        `;
        if (phoneFallback[0]?.id) {
          user = await this.prisma.user.findUnique({
            where: { id: phoneFallback[0].id },
          });
        }
      } catch (error) {
        this.logger.warn(
          `Login phone fallback query failed: ${
            (error as Error).message || String(error)
          }`,
        );
      }
    }

    return user;
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
    const canonicalLabel = resolveRoleLabel(role);
    if (canonicalLabel && canonicalLabel !== role) {
      return canonicalLabel;
    }

    return role
      .split('_')
      .map((segment) => segment.charAt(0) + segment.slice(1).toLowerCase())
      .join(' ');
  }

  private isEvzoneRole(role: UserRole | undefined): role is UserRole {
    if (!role) return false;
    return this.evzoneRoles.has(role);
  }

  private assertCanAssignEvzoneRole(
    assignerRole: UserRole,
    targetRole: UserRole,
    context: string,
  ) {
    if (!this.isEvzoneRole(targetRole)) return;
    if (this.isEvzoneRole(assignerRole)) return;

    throw new ForbiddenException(
      `Only platform roles can assign role "${targetRole}" (${context})`,
    );
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
    const existingCanonical = await client.organization.findFirst({
      where: {
        name: { equals: this.evzoneOrganizationName, mode: 'insensitive' },
      },
    });
    if (existingCanonical) {
      if (
        existingCanonical.logoUrl !== this.evzoneOrganizationLogoUrl ||
        existingCanonical.description !== this.evzoneOrganizationDescription
      ) {
        return client.organization.update({
          where: { id: existingCanonical.id },
          data: {
            logoUrl: this.evzoneOrganizationLogoUrl,
            description: this.evzoneOrganizationDescription,
          },
        });
      }
      return existingCanonical;
    }

    const legacyOrganization = await client.organization.findFirst({
      where: {
        name: {
          equals: this.legacyEvzoneOrganizationName,
          mode: 'insensitive',
        },
      },
    });
    if (legacyOrganization) {
      return client.organization.update({
        where: { id: legacyOrganization.id },
        data: {
          name: this.evzoneOrganizationName,
          logoUrl: this.evzoneOrganizationLogoUrl,
          description: this.evzoneOrganizationDescription,
        },
      });
    }

    return client.organization.create({
      data: {
        name: this.evzoneOrganizationName,
        type: 'COMPANY',
        logoUrl: this.evzoneOrganizationLogoUrl,
        description: this.evzoneOrganizationDescription,
      },
    });
  }

  private async enforceEvzoneOrganizationAssignment(
    params: {
      userId: string;
      role: UserRole;
      ownerCapability?: StationOwnerCapability | null;
      membershipStatus?: MembershipStatus;
      invitedBy?: string | null;
      customRoleId?: string | null;
      customRoleName?: string | null;
    },
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ): Promise<{ organizationId: string } | null> {
    if (!this.isEvzoneRole(params.role)) {
      return null;
    }

    const organization = await this.ensureEvzoneOrganization(client);
    const membershipStatus = params.membershipStatus || MembershipStatus.ACTIVE;

    await client.user.update({
      where: { id: params.userId },
      data: { organizationId: organization.id },
    });

    const membershipUpdateData: Prisma.OrganizationMembershipUpdateInput = {
      role: params.role,
      canonicalRoleKey: resolveCanonicalRoleKey(params.role),
      ownerCapability: params.ownerCapability || null,
      status: membershipStatus,
    };
    if (typeof params.invitedBy === 'string') {
      membershipUpdateData.invitedBy = params.invitedBy;
    }
    if (typeof params.customRoleId === 'string') {
      membershipUpdateData.customRoleId = params.customRoleId || null;
    }
    if (typeof params.customRoleName === 'string') {
      membershipUpdateData.customRoleName = params.customRoleName || null;
    }

    await client.organizationMembership.upsert({
      where: {
        userId_organizationId: {
          userId: params.userId,
          organizationId: organization.id,
        },
      },
      create: {
        userId: params.userId,
        organizationId: organization.id,
        role: params.role,
        canonicalRoleKey: resolveCanonicalRoleKey(params.role),
        ownerCapability: params.ownerCapability || null,
        status: membershipStatus,
        invitedBy: params.invitedBy || null,
        customRoleId: params.customRoleId || null,
        customRoleName: params.customRoleName || null,
      },
      update: membershipUpdateData,
    });

    return { organizationId: organization.id };
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

  private resolveEffectiveCanonicalRole(
    membership:
      | {
          canonicalRoleKey?: CanonicalRoleKey | null;
        }
      | null
      | undefined,
    effectiveRole: UserRole,
  ): CanonicalRoleKey | null {
    return (
      membership?.canonicalRoleKey || resolveCanonicalRoleKey(effectiveRole)
    );
  }

  private async resolveActiveCustomRoleAccess(
    activeOrganizationId: string | null,
    membership:
      | {
          customRoleId?: string | null;
        }
      | null
      | undefined,
  ): Promise<ActiveCustomRoleAccessSummary | null> {
    const customRoleId = membership?.customRoleId || null;

    if (!activeOrganizationId || !customRoleId) {
      return null;
    }

    const route =
      await this.tenantDirectory.findByOrganizationId(activeOrganizationId);

    return this.prisma.runWithTenantRouting(
      route ? this.tenantDirectory.toRoutingHint(route) : null,
      async () => {
        const customRole = await this.prisma.tenantCustomRole.findFirst({
          where: {
            id: customRoleId,
            organizationId: activeOrganizationId,
            status: CustomRoleStatus.ACTIVE,
          },
          select: {
            id: true,
            name: true,
            baseRoleKey: true,
            permissions: {
              select: {
                permissionCode: true,
              },
            },
          },
        });

        if (!customRole) {
          return null;
        }

        return {
          id: customRole.id,
          name: customRole.name,
          baseRoleKey: customRole.baseRoleKey,
          permissions: customRole.permissions.map(
            (permission: { permissionCode: string }) =>
              permission.permissionCode,
          ),
        };
      },
    );
  }

  private async resolveActivePlatformRoleKey(
    userId: string,
  ): Promise<CanonicalRoleKey | null> {
    const assignment = await this.prisma
      .getControlPlaneClient()
      .platformRoleAssignment.findFirst({
        where: {
          userId,
          status: MembershipStatus.ACTIVE,
        },
        orderBy: {
          createdAt: 'asc',
        },
      });

    return assignment?.roleKey || null;
  }

  private isPlatformScopeRole(roleKey: CanonicalRoleKey | null): boolean {
    if (!roleKey) {
      return false;
    }

    return getCanonicalRoleDefinition(roleKey)?.scopeType === 'platform';
  }

  private resolveScopeDisplayName(
    scopeType: AccessScopeType,
    context: {
      activeOrganizationName: string | null;
      activeStationName: string | null;
    },
  ): string {
    if (scopeType === 'platform') {
      return 'Platform';
    }

    if (scopeType === 'station') {
      return context.activeStationName || 'Station Scope';
    }

    if (scopeType === 'site') {
      return context.activeOrganizationName || 'Site Scope';
    }

    if (scopeType === 'provider') {
      return context.activeOrganizationName || 'Provider Scope';
    }

    if (scopeType === 'temporary') {
      return context.activeStationName || 'Temporary Scope';
    }

    if (scopeType === 'fleet_group') {
      return context.activeOrganizationName || 'Fleet Scope';
    }

    if (scopeType === 'device') {
      return context.activeStationName || 'Device Scope';
    }

    return context.activeOrganizationName || 'Tenant Scope';
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

  private hashIdentifier(input: string): string {
    return crypto.createHash('sha256').update(input).digest('hex').slice(0, 12);
  }

  private parseUserRole(input: string, context: string): UserRole {
    if (!(input in UserRole)) {
      throw new BadRequestException(`Invalid role "${input}" for ${context}`);
    }
    return input as UserRole;
  }

  private assertTeamManageableRole(role: UserRole, context: string) {
    if (!this.teamManageableRoles.has(role)) {
      throw new BadRequestException(
        `Role "${role}" is not allowed for team management (${context})`,
      );
    }
  }

  private requiresStationAssignments(role: UserRole): boolean {
    return this.stationScopedTeamRoles.has(role);
  }

  private resolveSessionScopedTenantId(
    sessionScope?: SessionTenantScopeOptions,
  ): string | null {
    if (!sessionScope) {
      return null;
    }

    const explicitTenantSession =
      sessionScope.sessionScopeType === 'tenant' ||
      sessionScope.actingAsTenant === true;
    if (!explicitTenantSession) {
      return null;
    }

    const selectedTenantId = sessionScope.selectedTenantId?.trim();
    return selectedTenantId ? selectedTenantId : null;
  }

  private resolveScopedOrganizationId(
    memberships: Array<{ organizationId: string }>,
    sessionTenantId: string | null,
  ): string | null {
    if (sessionTenantId) {
      return sessionTenantId;
    }

    return memberships.length === 1 ? memberships[0].organizationId : null;
  }

  private async getTeamManagerScope(
    actorId: string,
    sessionScope?: SessionTenantScopeOptions,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    if (!actorId) {
      throw new UnauthorizedException('Authenticated user context is required');
    }

    const actor = await client.user.findUnique({
      where: { id: actorId },
      select: {
        id: true,
        email: true,
        role: true,
        memberships: {
          where: {
            status: MembershipStatus.ACTIVE,
          },
          select: {
            organizationId: true,
            role: true,
          },
        },
      },
    });

    if (!actor) {
      throw new UnauthorizedException('Authenticated user not found');
    }

    const activeOrganizationId = this.resolveScopedOrganizationId(
      actor.memberships,
      this.resolveSessionScopedTenantId(sessionScope),
    );
    if (!activeOrganizationId) {
      throw new UnauthorizedException(
        'Authenticated user is missing an active tenant scope. Switch tenant before managing team members.',
      );
    }

    const membershipRoleForOrg = actor.memberships.find(
      (membership) => membership.organizationId === activeOrganizationId,
    )?.role;
    const effectiveManagerRole = membershipRoleForOrg || actor.role;

    if (!this.teamManagerRoles.has(effectiveManagerRole)) {
      throw new UnauthorizedException(
        'Only approved platform and organization roles can manage team members',
      );
    }

    return {
      actor,
      organizationId: activeOrganizationId,
      managerRole: effectiveManagerRole,
    };
  }

  private async ensureTeamMemberInScope(
    targetUserId: string,
    scopeOrganizationId: string,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    const target = await client.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        organizationId: true,
        ownerCapability: true,
        memberships: {
          where: {
            organizationId: scopeOrganizationId,
          },
          select: {
            id: true,
            status: true,
            role: true,
            ownerCapability: true,
          },
        },
      },
    });

    if (!target) {
      throw new NotFoundException('Team member not found');
    }

    if (
      target.organizationId !== scopeOrganizationId &&
      target.memberships.length === 0
    ) {
      throw new UnauthorizedException(
        'Target user is not part of your active organization scope',
      );
    }

    return target;
  }

  private normalizeTeamAssignments(
    assignments: TeamStationAssignmentDto[],
    context: string,
  ): Array<{
    stationId: string;
    role: UserRole;
    isPrimary: boolean;
    isActive: boolean;
    attendantMode: AttendantRoleMode | null;
    shiftStart: string | null;
    shiftEnd: string | null;
    timezone: string | null;
  }> {
    if (!assignments?.length) {
      throw new BadRequestException(
        'At least one station assignment is required',
      );
    }

    const dedupe = new Map<string, TeamStationAssignmentDto>();
    for (const assignment of assignments) {
      if (!assignment.stationId?.trim()) {
        throw new BadRequestException(
          'stationId is required for each assignment',
        );
      }
      if (dedupe.has(assignment.stationId)) {
        throw new BadRequestException(
          `Duplicate station assignment for station ${assignment.stationId}`,
        );
      }
      dedupe.set(assignment.stationId, assignment);
    }

    const normalized = Array.from(dedupe.values()).map((assignment) => {
      const role = this.parseUserRole(assignment.role as string, context);
      this.assertTeamManageableRole(role, context);

      const isActive = assignment.isActive ?? true;
      const isPrimary = assignment.isPrimary ?? false;

      if (role === UserRole.ATTENDANT) {
        return {
          stationId: assignment.stationId,
          role,
          isPrimary,
          isActive,
          attendantMode: assignment.attendantMode || AttendantRoleMode.FIXED,
          shiftStart: assignment.shiftStart || '00:00',
          shiftEnd: assignment.shiftEnd || '23:59',
          timezone: assignment.timezone || this.defaultAttendantTimezone,
        };
      }

      return {
        stationId: assignment.stationId,
        role,
        isPrimary,
        isActive,
        attendantMode: null,
        shiftStart: null,
        shiftEnd: null,
        timezone: null,
      };
    });

    const hasPrimary = normalized.some((assignment) => assignment.isPrimary);
    if (!hasPrimary && normalized.length > 0) {
      normalized[0].isPrimary = true;
    }

    const activeAssignments = normalized.filter(
      (assignment) => assignment.isActive,
    );
    if (
      activeAssignments.length > 0 &&
      !activeAssignments.some((item) => item.isPrimary)
    ) {
      activeAssignments[0].isPrimary = true;
    }

    return normalized;
  }

  private async validateStationsInOrganizationScope(
    stationIds: string[],
    organizationId: string,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    const stations = await client.station.findMany({
      where: {
        id: { in: stationIds },
      },
      select: {
        id: true,
        name: true,
        orgId: true,
      },
    });

    if (stations.length !== stationIds.length) {
      const existingIds = new Set(stations.map((station) => station.id));
      const missing = stationIds.filter(
        (stationId) => !existingIds.has(stationId),
      );
      throw new NotFoundException(
        `One or more stations do not exist: ${missing.join(', ')}`,
      );
    }

    const outOfScope = stations.find(
      (station) => station.orgId !== organizationId,
    );
    if (outOfScope) {
      throw new UnauthorizedException(
        `Station ${outOfScope.id} is outside your organization scope`,
      );
    }

    return stations;
  }

  private async syncAttendantProjectionForUser(
    userId: string,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    const activeAttendantAssignments =
      await client.stationTeamAssignment.findMany({
        where: {
          userId,
          isActive: true,
          role: UserRole.ATTENDANT,
        },
        select: {
          id: true,
          stationId: true,
          attendantMode: true,
          shiftStart: true,
          shiftEnd: true,
          timezone: true,
        },
      });

    const existingAttendantRows = await client.attendantAssignment.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        stationId: true,
        isActive: true,
      },
    });

    const activeStationIdSet = new Set(
      activeAttendantAssignments.map((assignment) => assignment.stationId),
    );

    const existingByStation = new Map<
      string,
      Array<{ id: string; stationId: string; isActive: boolean }>
    >();
    for (const row of existingAttendantRows) {
      const rows = existingByStation.get(row.stationId) || [];
      rows.push(row);
      existingByStation.set(row.stationId, rows);
    }

    for (const assignment of activeAttendantAssignments) {
      const existingRowsForStation =
        existingByStation.get(assignment.stationId) || [];
      const primaryRow = existingRowsForStation[0];
      const roleMode = assignment.attendantMode || AttendantRoleMode.FIXED;
      const shiftStart = assignment.shiftStart || '00:00';
      const shiftEnd = assignment.shiftEnd || '23:59';
      const timezone = assignment.timezone || this.defaultAttendantTimezone;

      if (primaryRow) {
        await client.attendantAssignment.update({
          where: { id: primaryRow.id },
          data: {
            roleMode,
            shiftStart,
            shiftEnd,
            timezone,
            isActive: true,
          },
        });

        const duplicateIds = existingRowsForStation
          .slice(1)
          .map((row) => row.id);
        if (duplicateIds.length > 0) {
          await client.attendantAssignment.updateMany({
            where: { id: { in: duplicateIds } },
            data: { isActive: false },
          });
        }
      } else {
        await client.attendantAssignment.create({
          data: {
            userId,
            stationId: assignment.stationId,
            roleMode,
            shiftStart,
            shiftEnd,
            timezone,
            isActive: true,
          },
        });
      }
    }

    const staleRows = existingAttendantRows.filter(
      (row) => !activeStationIdSet.has(row.stationId) && row.isActive,
    );
    if (staleRows.length > 0) {
      await client.attendantAssignment.updateMany({
        where: {
          id: { in: staleRows.map((row) => row.id) },
        },
        data: {
          isActive: false,
        },
      });
    }
  }

  private async resolveStationContexts(
    userId: string,
    organizationId: string | null,
    lastStationAssignmentId?: string | null,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    const where: Prisma.StationTeamAssignmentWhereInput = {
      userId,
      isActive: true,
    };

    if (organizationId) {
      where.station = {
        orgId: organizationId,
      };
    }

    const assignments = await client.stationTeamAssignment.findMany({
      where,
      include: {
        station: {
          select: {
            id: true,
            name: true,
            orgId: true,
          },
        },
      },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });

    const stationContexts = assignments.map((assignment) => ({
      assignmentId: assignment.id,
      stationId: assignment.stationId,
      stationName: assignment.station?.name || null,
      organizationId: assignment.station?.orgId || null,
      role: assignment.role,
      isPrimary: assignment.isPrimary,
      attendantMode: assignment.attendantMode,
      shiftStart: assignment.shiftStart,
      shiftEnd: assignment.shiftEnd,
      timezone: assignment.timezone,
    }));

    const activeStationContext =
      stationContexts.find(
        (context) => context.assignmentId === lastStationAssignmentId,
      ) ||
      stationContexts.find((context) => context.isPrimary) ||
      stationContexts[0] ||
      null;

    return {
      stationContexts,
      activeStationContext,
    };
  }

  private validatePayoutProfileInput(payload: StaffPayoutProfileDto) {
    if (payload.method === PayoutMethod.MOBILE_MONEY && !payload.phoneNumber) {
      throw new BadRequestException(
        'phoneNumber is required for MOBILE_MONEY payout profiles',
      );
    }

    if (
      payload.method === PayoutMethod.BANK_TRANSFER &&
      (!payload.bankName || !payload.accountNumber)
    ) {
      throw new BadRequestException(
        'bankName and accountNumber are required for BANK_TRANSFER payout profiles',
      );
    }
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
    const { email: normalizedEmail, phone: normalizedPhone } =
      this.resolveLoginIdentifiers(loginDto);
    const monitoringContext = this.createMonitoringContext(
      context,
      'login',
      normalizedEmail || normalizedPhone,
    );
    try {
      if (!normalizedEmail && !normalizedPhone) {
        throw new BadRequestException('Email or phone is required');
      }

      this.logger.log(
        `Login attempt for ${normalizedEmail || normalizedPhone}`,
      );
      let user = await this.findUserForLogin(normalizedEmail, normalizedPhone);
      if (!user) {
        this.logger.warn(
          `Login denied: account not found for ${normalizedEmail || normalizedPhone}`,
        );
        throw new UnauthorizedException('Invalid credentials');
      }

      if (!user.passwordHash) {
        this.logger.warn(
          `Login denied: user ${user.id} has no password hash configured`,
        );
        throw new UnauthorizedException('Invalid credentials');
      }

      const isPasswordValid = await this.verifyAndUpgradeUserPassword(
        user.id,
        loginDto.password,
        user.passwordHash,
      );
      if (!isPasswordValid) {
        this.logger.warn(`Login denied: password mismatch for user ${user.id}`);
        throw new UnauthorizedException('Invalid credentials');
      }

      await this.enforceLoginMfa(user, loginDto);

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
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Login error for ${loginDto.email || loginDto.phone}: ${errorMessage}`,
        errorStack,
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
        usedTempPassword = await this.comparePasswordWithLegacySupport(
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
          canonicalRoleKey:
            invitation.canonicalRoleKey ||
            resolveCanonicalRoleKey(invitation.role),
          customRoleId: invitation.customRoleId,
          customRoleName: invitation.customRoleName,
          ownerCapability: invitation.ownerCapability,
          status: MembershipStatus.ACTIVE,
          invitedBy: invitation.invitedBy || undefined,
        },
        update: {
          role: invitation.role,
          canonicalRoleKey:
            invitation.canonicalRoleKey ||
            resolveCanonicalRoleKey(invitation.role),
          customRoleId: invitation.customRoleId,
          customRoleName: invitation.customRoleName,
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

      let materializedAssignmentCount = 0;
      const rawInitialAssignments = invitation.initialAssignmentsJson;
      if (
        Array.isArray(rawInitialAssignments) &&
        rawInitialAssignments.length > 0
      ) {
        const normalizedAssignments = this.normalizeTeamAssignments(
          rawInitialAssignments as unknown as TeamStationAssignmentDto[],
          'invitation activation',
        );
        await this.validateStationsInOrganizationScope(
          normalizedAssignments.map((assignment) => assignment.stationId),
          invitation.organizationId,
          tx,
        );

        await tx.stationTeamAssignment.updateMany({
          where: {
            userId: user.id,
            stationId: {
              in: normalizedAssignments.map(
                (assignment) => assignment.stationId,
              ),
            },
            isActive: true,
          },
          data: {
            isActive: false,
            isPrimary: false,
          },
        });

        const createdAssignments: Array<{ id: string; isPrimary: boolean }> =
          [];
        for (const assignment of normalizedAssignments) {
          const created = await tx.stationTeamAssignment.create({
            data: {
              userId: user.id,
              stationId: assignment.stationId,
              role: assignment.role,
              isPrimary: assignment.isPrimary,
              isActive: assignment.isActive,
              assignedByUserId: invitation.invitedBy || null,
              attendantMode: assignment.attendantMode,
              shiftStart: assignment.shiftStart,
              shiftEnd: assignment.shiftEnd,
              timezone: assignment.timezone,
            },
            select: { id: true, isPrimary: true },
          });
          createdAssignments.push(created);
        }

        materializedAssignmentCount = createdAssignments.length;
        const preferredAssignment =
          createdAssignments.find((assignment) => assignment.isPrimary) ||
          createdAssignments[0];

        if (preferredAssignment) {
          await tx.user.update({
            where: { id: user.id },
            data: {
              lastStationAssignmentId: preferredAssignment.id,
            },
          });
        }

        await this.syncAttendantProjectionForUser(user.id, tx);
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
        organizationName:
          invitation.organization?.name || this.evzoneOrganizationName,
        invitedBy: invitation.invitedBy,
        inviteeEmail: invitation.email,
        role: invitation.role,
        usedTempPassword,
        materializedAssignmentCount,
      };
    });

    await this.recordAuditEvent({
      actor: input.userId,
      action: 'INVITE_ACTIVATED',
      resource: 'UserInvitation',
      resourceId: activation.invitationId,
      details: {
        organizationId: activation.organizationId,
        assignmentSeedCount: activation.materializedAssignmentCount,
      },
    });

    try {
      await this.notificationService.notifyInvitationAccepted({
        invitedUserId: input.userId,
        inviterUserId: activation.invitedBy,
        inviteeEmail: activation.inviteeEmail,
        organizationName: activation.organizationName,
        role: activation.role,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to dispatch invitation acceptance notifications: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return {
      organizationId: activation.organizationId,
      usedTempPassword: activation.usedTempPassword,
    };
  }

  private async generateAuthResponse(
    user: AuthUserContextInput,
    options?: AuthSessionContextOptions,
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
            {
              userId: exists.id,
              zoneId: exists.zoneId,
              country: exists.country,
              region: exists.region,
            },
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
    const geography = await this.resolveGeography(
      {
        zoneId: createUserDto.zoneId,
        region: createUserDto.region,
        country: createUserDto.country,
      },
      'register',
      this.prisma,
    );

    const user = await this.prisma.user.create({
      data: {
        email: createUserDto.email,
        name: createUserDto.name,
        phone: createUserDto.phone,
        role: UserRole.SITE_OWNER,
        status: 'Pending',
        passwordHash: hashedPassword,
        country: createUserDto.country,
        region: geography.region,
        zoneId: geography.zoneId,
        subscribedPackage: createUserDto.subscribedPackage || 'Free',
        ownerCapability:
          (createUserDto.ownerCapability as StationOwnerCapability | null) ||
          null,
        organizationId: null,
      },
    });

    await this.syncOcpiTokenSafe(user);

    try {
      const verificationToken = await this.generateEmailVerificationToken(
        user.id,
      );
      await this.mailService.sendVerificationEmail(
        createUserDto.email,
        verificationToken,
        createUserDto.frontendUrl,
        {
          userId: user.id,
          zoneId: user.zoneId,
          country: user.country,
          region: user.region,
        },
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
        id: user.id,
        email: user.email,
        organizationId: null,
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
        role: true,
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
    const inviteRole = this.parseUserRole(inviteDto.role as string, 'invite');
    this.assertTeamManageableRole(inviteRole, 'invite');
    this.assertCanAssignEvzoneRole(inviter.role, inviteRole, 'invite');
    const normalizedInitialAssignments = inviteDto.initialAssignments?.length
      ? this.normalizeTeamAssignments(inviteDto.initialAssignments, 'invite')
      : [];
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

    if (normalizedInitialAssignments.length > 0) {
      await this.validateStationsInOrganizationScope(
        normalizedInitialAssignments.map((assignment) => assignment.stationId),
        organizationId,
      );
    }

    const existingUser = await this.prisma.user.findFirst({
      where: {
        email: { equals: normalizedEmail, mode: 'insensitive' },
      },
      select: {
        id: true,
        email: true,
        phone: true,
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
          canonicalRoleKey: resolveCanonicalRoleKey(inviteRole),
          customRoleId: inviteDto.customRoleId || null,
          customRoleName: inviteDto.customRoleName || null,
          ownerCapability:
            inviteDto.ownerCapability as unknown as StationOwnerCapability,
          status: MembershipStatus.INVITED,
          invitedBy: inviter.id,
        },
        update: {
          role: inviteRole,
          canonicalRoleKey: resolveCanonicalRoleKey(inviteRole),
          customRoleId: inviteDto.customRoleId || null,
          customRoleName: inviteDto.customRoleName || null,
          ownerCapability:
            inviteDto.ownerCapability as unknown as StationOwnerCapability,
          status: MembershipStatus.INVITED,
          invitedBy: inviter.id,
        },
      });

      await this.enforceEvzoneOrganizationAssignment(
        {
          userId,
          role: inviteRole,
          ownerCapability:
            (inviteDto.ownerCapability as unknown as StationOwnerCapability) ||
            null,
          membershipStatus: MembershipStatus.INVITED,
          invitedBy: inviter.id,
          customRoleId: inviteDto.customRoleId || null,
          customRoleName: inviteDto.customRoleName || null,
        },
        tx,
      );

      const invitation = await tx.userInvitation.create({
        data: {
          email: normalizedEmail,
          userId,
          organizationId,
          role: inviteRole,
          canonicalRoleKey: resolveCanonicalRoleKey(inviteRole),
          customRoleId: inviteDto.customRoleId || null,
          customRoleName: inviteDto.customRoleName || null,
          ownerCapability:
            inviteDto.ownerCapability as unknown as StationOwnerCapability,
          invitedBy: inviter.id,
          tokenHash,
          status: InvitationStatus.PENDING,
          expiresAt,
          tempPasswordHash,
          tempPasswordIssuedAt: tempPassword ? new Date() : null,
          ...(normalizedInitialAssignments.length > 0
            ? {
                initialAssignmentsJson:
                  normalizedInitialAssignments as unknown as Prisma.InputJsonValue,
              }
            : {}),
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
    const organizationName = organization?.name || this.evzoneOrganizationName;

    try {
      await this.mailService.sendInvitationEmail(
        normalizedEmail,
        this.toRoleLabel(inviteRole),
        organizationName,
        inviteDto.frontendUrl,
        inviteToken,
        invitationResult.tempPassword,
        {
          userId: existingUser?.id,
          zoneId: inviteDto.zoneId || existingUser?.zoneId || inviter.zoneId,
          country: existingUser?.country || inviter.country,
          region: inviteDto.region || existingUser?.region || inviter.region,
        },
      );
    } catch (error) {
      this.logger.error(
        'Failed to send invitation email',
        String(error).replace(/[\n\r]/g, ''),
      );
    }

    if (existingUser?.phone) {
      try {
        await this.notificationService.sendSms(
          existingUser.phone,
          `EVzone: You have been invited to join ${organizationName}. Check your email to accept the invitation.`,
          {
            userId: existingUser.id,
            zoneId: inviteDto.zoneId || existingUser.zoneId || inviter.zoneId,
            country: existingUser.country || inviter.country,
            region: inviteDto.region || existingUser.region || inviter.region,
          },
        );
      } catch (error) {
        this.logger.warn(
          `Failed to send invitation SMS: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    if (existingUser?.id) {
      try {
        this.notificationService.sendPush(
          existingUser.id,
          'Team invitation',
          `You have been invited to join ${organizationName}.`,
          {
            type: 'invite.sent',
            metadata: {
              organizationId,
              role: inviteRole,
            },
          },
        );
      } catch (error) {
        this.logger.warn(
          `Failed to queue invitation push notification: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
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
        customRoleId: inviteDto.customRoleId || null,
        customRoleName: inviteDto.customRoleName || null,
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
      organizationName:
        invitation.organization?.name || this.evzoneOrganizationName,
      role: invitation.role,
      requiresTempPassword: Boolean(invitation.tempPasswordHash),
      inviteToken,
    };
  }

  async switchOrganization(
    userId: string,
    organizationId: string,
  ): Promise<AuthSessionTokensResponse> {
    if (!userId) {
      throw new UnauthorizedException('Authenticated user context is required');
    }

    const normalizedOrganizationId = organizationId?.trim();
    if (!normalizedOrganizationId) {
      throw new BadRequestException('organizationId is required');
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

    const platformRoleKey = await this.resolveActivePlatformRoleKey(user.id);
    const fallbackCanonicalRole = resolveCanonicalRoleKey(user.role);
    const isPlatformPrincipal = this.isPlatformScopeRole(
      platformRoleKey || fallbackCanonicalRole,
    );
    if (isPlatformPrincipal) {
      return this.switchTenant(userId, normalizedOrganizationId);
    }

    const membership = await this.prisma.organizationMembership.findUnique({
      where: {
        userId_organizationId: {
          userId,
          organizationId: normalizedOrganizationId,
        },
      },
    });

    if (!membership || membership.status !== MembershipStatus.ACTIVE) {
      throw new UnauthorizedException(
        'No active membership found for selected organization',
      );
    }

    if (user.organizationId !== normalizedOrganizationId) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { organizationId: normalizedOrganizationId },
      });
      user.organizationId = normalizedOrganizationId;
    }

    await this.recordAuditEvent({
      actor: user.id,
      action: 'ORG_SWITCHED',
      resource: 'OrganizationMembership',
      resourceId: membership.id,
      details: {
        organizationId: normalizedOrganizationId,
      },
    });

    return this.generateAuthResponse(user, {
      preferredOrganizationId: normalizedOrganizationId,
      sessionScopeType: 'tenant',
      actingAsTenant: true,
      selectedTenantId: normalizedOrganizationId,
      selectedTenantName: null,
    });
  }

  async switchTenant(
    userId: string,
    tenantId?: string | null,
    reason?: string | null,
  ): Promise<AuthSessionTokensResponse> {
    if (!userId) {
      throw new UnauthorizedException('Authenticated user context is required');
    }

    const normalizedTenantId = tenantId?.trim() || null;
    const normalizedReason = reason?.trim() || null;
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

    const platformRoleKey = await this.resolveActivePlatformRoleKey(user.id);
    const fallbackCanonicalRole = resolveCanonicalRoleKey(user.role);
    const isPlatformPrincipal = this.isPlatformScopeRole(
      platformRoleKey || fallbackCanonicalRole,
    );

    if (!isPlatformPrincipal) {
      if (!normalizedTenantId) {
        throw new BadRequestException('tenantId is required');
      }
      return this.switchOrganization(userId, normalizedTenantId);
    }

    const platformSessionContext = await this.buildAuthUserContext(user, {
      sessionScopeType: 'platform',
      actingAsTenant: false,
    });
    const platformSessionUser = this.buildAuthenticatedUserPayload(
      user,
      platformSessionContext,
    );
    const canImpersonateTenant =
      platformSessionUser.permissions.includes('platform.tenants.read') ||
      platformSessionUser.permissions.includes('platform.tenants.write');

    if (!canImpersonateTenant) {
      throw new ForbiddenException(
        'Platform tenant switching requires platform tenant permissions',
      );
    }

    if (!normalizedTenantId) {
      const clearedAt = new Date().toISOString();
      await this.recordAuditEvent({
        actor: user.id,
        action: 'TENANT_IMPERSONATION_CLEARED',
        resource: 'User',
        resourceId: user.id,
        details: {
          actionType: 'STOP_IMPERSONATION',
          actorUserId: user.id,
          impersonationState: 'stopped',
          occurredAt: clearedAt,
          reason: normalizedReason,
        },
      });

      return this.generateAuthResponse(user, {
        sessionScopeType: 'platform',
        actingAsTenant: false,
        selectedTenantId: null,
        selectedTenantName: null,
      });
    }

    const selectedTenant = await this.prisma
      .getControlPlaneClient()
      .organization.findUnique({
        where: { id: normalizedTenantId },
        select: {
          id: true,
          name: true,
          suspendedAt: true,
        },
      });

    if (!selectedTenant) {
      throw new NotFoundException('Selected tenant was not found');
    }

    if (selectedTenant.suspendedAt) {
      throw new ForbiddenException('Selected tenant is suspended');
    }

    const impersonationStartedAt = new Date().toISOString();
    await this.recordAuditEvent({
      actor: user.id,
      action: 'TENANT_IMPERSONATION_STARTED',
      resource: 'Organization',
      resourceId: selectedTenant.id,
      details: {
        actionType: 'START_IMPERSONATION',
        actorUserId: user.id,
        impersonationState: 'started',
        occurredAt: impersonationStartedAt,
        tenantId: selectedTenant.id,
        tenantName: selectedTenant.name,
        reason: normalizedReason,
      },
    });

    return this.generateAuthResponse(user, {
      preferredOrganizationId: selectedTenant.id,
      sessionScopeType: 'tenant',
      actingAsTenant: true,
      selectedTenantId: selectedTenant.id,
      selectedTenantName: selectedTenant.name,
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
        type: 'service',
      };

      const token = jwt.sign(
        payload,
        this.config.get<string>('JWT_SERVICE_SECRET') || 'dev_secret',
        {
          expiresIn:
            (this.config.get(
              'JWT_SERVICE_EXPIRY',
            ) as SignOptions['expiresIn']) || '1y',
          issuer: this.config.get<string>('JWT_SERVICE_ISSUER'),
          audience: this.config.get<string>('JWT_SERVICE_AUDIENCE'),
        },
      );

      this.anomalyMonitor.recordSuccess(monitoringContext);
      return {
        accessToken: token,
        expiresIn: this.config.get<string>('JWT_SERVICE_EXPIRY') || '1y',
      };
    } catch (error) {
      this.anomalyMonitor.recordFailure(
        monitoringContext,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  private resolveOtpDeliveryChannel(
    user: {
      email: string | null;
      phone: string | null;
    },
    requested?: OtpChannel,
  ): OtpDeliveryChannel {
    if (requested === OtpChannel.SMS) {
      if (!user.phone) {
        throw new BadRequestException(
          'SMS OTP is unavailable because no phone number is configured on this account',
        );
      }
      return OtpChannel.SMS;
    }

    if (requested === OtpChannel.EMAIL) {
      if (!user.email) {
        throw new BadRequestException(
          'Email OTP is unavailable because no email address is configured on this account',
        );
      }
      return OtpChannel.EMAIL;
    }

    if (user.email) {
      return OtpChannel.EMAIL;
    }

    if (user.phone) {
      return OtpChannel.SMS;
    }

    throw new BadRequestException(
      'No email or phone number is configured for OTP delivery',
    );
  }

  private maskOtpDestination(
    channel: OtpDeliveryChannel,
    destination: string,
  ): string {
    const trimmed = destination.trim();
    if (!trimmed) {
      return channel === OtpChannel.EMAIL ? 'email' : 'phone';
    }

    if (channel === OtpChannel.EMAIL) {
      const [localPartRaw, domainRaw] = trimmed.split('@');
      const localPart = localPartRaw || '';
      const domain = domainRaw || '';
      if (!domain) {
        return `${localPart.slice(0, 2)}***`;
      }

      const visibleLocal = localPart.slice(0, 2);
      return `${visibleLocal}***@${domain}`;
    }

    const digitsOnly = trimmed.replace(/\D/g, '');
    if (digitsOnly.length <= 4) {
      return `***${digitsOnly}`;
    }

    return `***${digitsOnly.slice(-4)}`;
  }

  private generateOtpCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  private async sendOtpChallengeToUser(
    user: {
      id: string;
      email: string | null;
      phone: string | null;
      zoneId?: string | null;
      country?: string | null;
      region?: string | null;
    },
    requestedChannel?: OtpChannel,
    purpose: 'login' | 'setup' = 'login',
  ): Promise<{
    channel: OtpDeliveryChannel;
    expiresAt: Date;
    maskedDestination: string;
  }> {
    const channel = this.resolveOtpDeliveryChannel(user, requestedChannel);
    const destination = channel === OtpChannel.EMAIL ? user.email : user.phone;
    if (!destination) {
      throw new BadRequestException('Unable to resolve OTP destination');
    }

    const code = this.generateOtpCode();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { otpCode: code, otpExpiresAt: expiresAt },
    });

    const messagePrefix =
      purpose === 'setup'
        ? 'Your EVZONE MFA setup code is'
        : 'Your EVZONE sign-in code is';

    if (channel === OtpChannel.EMAIL) {
      await this.mailService.sendMail(
        destination,
        'Verification OTP',
        `<p>${messagePrefix} <b>${code}</b></p><p>This code expires in 5 minutes.</p>`,
        {
          userId: user.id,
          zoneId: user.zoneId,
          country: user.country,
          region: user.region,
        },
      );
    } else {
      await this.notificationService.sendSms(
        destination,
        `EVZONE: ${messagePrefix} ${code}. It expires in 5 minutes.`,
        {
          userId: user.id,
          zoneId: user.zoneId,
          country: user.country,
          region: user.region,
        },
      );
    }

    return {
      channel,
      expiresAt,
      maskedDestination: this.maskOtpDestination(channel, destination),
    };
  }

  private async consumeUserOtpCode(
    userId: string,
    providedCode: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        otpCode: true,
        otpExpiresAt: true,
      },
    });

    if (!user || !user.otpCode) {
      throw new UnauthorizedException('Invalid OTP');
    }

    if (!this.constantTimeCompare(user.otpCode, providedCode)) {
      throw new UnauthorizedException('Invalid OTP');
    }

    if (!user.otpExpiresAt || new Date() > user.otpExpiresAt) {
      throw new UnauthorizedException('OTP Expired');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        otpCode: null,
        otpExpiresAt: null,
      },
    });
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

      await this.sendOtpChallengeToUser(
        {
          id: user.id,
          email: user.email || null,
          phone: user.phone || null,
          zoneId: user.zoneId,
          country: user.country,
          region: user.region,
        },
        isEmail ? OtpChannel.EMAIL : OtpChannel.SMS,
        'setup',
      );

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

      return this.issueTokens(updatedUser);
    } catch (error) {
      this.anomalyMonitor.recordFailure(
        monitoringContext,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  async sendMfaSetupOtp(
    userId: string,
    channel?: OtpChannel,
  ): Promise<{
    success: boolean;
    channel: OtpDeliveryChannel;
    destination: string;
    expiresAt: string;
  }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        phone: true,
        zoneId: true,
        country: true,
        region: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const challenge = await this.sendOtpChallengeToUser(
      user,
      channel,
      'setup',
    );

    await this.recordAuditEvent({
      actor: userId,
      action: 'MFA_SETUP_OTP_SENT',
      resource: 'User',
      resourceId: userId,
      details: {
        channel: challenge.channel,
      },
    });

    return {
      success: true,
      channel: challenge.channel,
      destination: challenge.maskedDestination,
      expiresAt: challenge.expiresAt.toISOString(),
    };
  }

  async verifyMfaSetupOtp(
    userId: string,
    code: string,
  ): Promise<{ success: boolean; message: string }> {
    const normalizedCode = code.trim();
    if (!normalizedCode) {
      throw new BadRequestException('OTP code is required');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        status: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    this.assertTwoFactorAttemptAllowed(userId, 'verify');
    try {
      await this.consumeUserOtpCode(userId, normalizedCode);
    } catch (error) {
      this.registerTwoFactorFailure(userId, 'verify');
      throw error;
    }

    this.clearTwoFactorFailures(userId, 'verify');

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        mfaRequired: true,
        status: user.status === 'MfaRequired' ? 'Active' : user.status,
      },
    });

    await this.recordAuditEvent({
      actor: userId,
      action: 'MFA_SETUP_COMPLETED_OTP',
      resource: 'User',
      resourceId: userId,
    });

    return {
      success: true,
      message: 'OTP-based MFA is now enabled',
    };
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
    user: AuthUserContextInput,
    options?: AuthSessionContextOptions,
  ) {
    const activeMemberships = await this.getActiveMemberships(user.id);
    const memberships = activeMemberships;

    const platformRoleKey = await this.resolveActivePlatformRoleKey(user.id);
    const fallbackCanonicalRole = resolveCanonicalRoleKey(user.role);
    const isPlatformPrincipal = this.isPlatformScopeRole(
      platformRoleKey || fallbackCanonicalRole,
    );
    const selectedTenantIdInput =
      options?.selectedTenantId || options?.preferredOrganizationId || null;
    const requestedTenantSession =
      options?.sessionScopeType === 'tenant' ||
      options?.actingAsTenant === true ||
      Boolean(selectedTenantIdInput);

    let activeOrganizationId = this.resolveActiveOrganizationId(
      memberships,
      null,
      selectedTenantIdInput,
    );
    if (isPlatformPrincipal) {
      activeOrganizationId =
        requestedTenantSession && selectedTenantIdInput
          ? selectedTenantIdInput
          : null;
    }

    const { stationContexts, activeStationContext } =
      isPlatformPrincipal && !activeOrganizationId
        ? {
            stationContexts: [] as AccessStationContextSummary[],
            activeStationContext: null,
          }
        : await this.resolveStationContexts(
            user.id,
            activeOrganizationId,
            user.lastStationAssignmentId,
          );
    const membershipRole = this.resolveEffectiveRole(
      user,
      memberships.map((membership) => ({
        organizationId: membership.organizationId,
        role: membership.role,
      })),
      activeOrganizationId,
    );
    const effectiveRole = activeStationContext?.role || membershipRole;
    const activeMembership =
      memberships.find(
        (membership) => membership.organizationId === activeOrganizationId,
      ) || null;
    const activeCustomRole = await this.resolveActiveCustomRoleAccess(
      activeOrganizationId,
      activeMembership,
    );
    const resolvedActiveCustomRole = platformRoleKey ? null : activeCustomRole;
    const effectiveCanonicalRole =
      platformRoleKey ||
      resolvedActiveCustomRole?.baseRoleKey ||
      this.resolveEffectiveCanonicalRole(activeMembership, effectiveRole);
    const sessionScopeType: SessionScopeType = activeOrganizationId
      ? 'tenant'
      : 'platform';
    const actingAsTenant = Boolean(activeOrganizationId);
    const activeOrganizationName =
      activeMembership?.organization?.name ||
      options?.selectedTenantName ||
      null;
    const selectedTenantId = actingAsTenant ? activeOrganizationId : null;
    const selectedTenantName = actingAsTenant
      ? activeOrganizationName || options?.selectedTenantName || null
      : null;

    if (!isPlatformPrincipal) {
      await this.syncLegacyOrganizationId(
        user.id,
        user.organizationId,
        activeOrganizationId,
      );
    }
    if (
      activeStationContext &&
      user.lastStationAssignmentId !== activeStationContext.assignmentId
    ) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          lastStationAssignmentId: activeStationContext.assignmentId,
        },
      });
    }

    return {
      activeOrganizationId,
      activeOrganizationName,
      activeTenantId: selectedTenantId,
      effectiveRole,
      effectiveCanonicalRole,
      activeCustomRole: resolvedActiveCustomRole,
      sessionScopeType,
      actingAsTenant,
      selectedTenantId,
      selectedTenantName,
      memberships: memberships.map((membership) => ({
        id: membership.id,
        organizationId: membership.organizationId,
        tenantId: membership.organizationId,
        role: membership.role,
        canonicalRoleKey:
          membership.canonicalRoleKey ||
          resolveCanonicalRoleKey(membership.role),
        customRoleId: membership.customRoleId || null,
        customRoleName: membership.customRoleName || null,
        ownerCapability: membership.ownerCapability || undefined,
        status: membership.status,
        organizationName: membership.organization?.name,
        tenantName: membership.organization?.name,
        organizationType: membership.organization?.type,
        tenantType: membership.organization?.type,
      })),
      stationContexts,
      activeStationContext,
    };
  }

  private buildAuthenticatedUserPayload(
    user: {
      id: string;
      email?: string | null;
      phone?: string | null;
      providerId?: string | null;
      name: string;
      status: string;
      region?: string | null;
      zoneId?: string | null;
      ownerCapability?: StationOwnerCapability | null;
      mustChangePassword?: boolean | null;
      mfaRequired?: boolean | null;
      twoFactorEnabled?: boolean | null;
      organizationId?: string | null;
    },
    context: {
      activeOrganizationId: string | null;
      activeOrganizationName: string | null;
      activeTenantId: string | null;
      effectiveRole: UserRole;
      effectiveCanonicalRole: CanonicalRoleKey | null;
      activeCustomRole: ActiveCustomRoleAccessSummary | null;
      sessionScopeType: SessionScopeType;
      actingAsTenant: boolean;
      selectedTenantId: string | null;
      selectedTenantName: string | null;
      memberships: AccessMembershipSummary[];
      stationContexts: AccessStationContextSummary[];
      activeStationContext: AccessStationContextSummary | null;
    },
  ) {
    const accessProfile = this.accessProfileService.buildProfile({
      activeOrganizationId: context.activeOrganizationId,
      activeTenantId: context.activeTenantId,
      effectiveRole: context.effectiveRole,
      effectiveCanonicalRole: context.effectiveCanonicalRole,
      memberships: context.memberships,
      stationContexts: context.stationContexts,
      activeStationContext: context.activeStationContext,
      providerId: user.providerId || null,
      customRole: context.activeCustomRole,
    });

    const membershipSummaries = context.memberships.map((membership) => {
      const canonicalRole =
        membership.canonicalRoleKey || resolveCanonicalRoleKey(membership.role);

      return {
        ...membership,
        tenantId: membership.organizationId,
        tenantName:
          membership.tenantName ||
          membership.organizationName ||
          membership.organizationId,
        canonicalRole,
        roleLabel:
          membership.customRoleName ||
          resolveRoleLabel(canonicalRole || membership.role),
      };
    });
    const activeTenantId = context.actingAsTenant
      ? context.activeTenantId || context.selectedTenantId
      : null;
    const activeOrganizationId = context.actingAsTenant
      ? context.activeOrganizationId || context.selectedTenantId
      : null;
    const activeTenantName =
      context.actingAsTenant && activeTenantId
        ? context.selectedTenantName ||
          context.activeOrganizationName ||
          membershipSummaries.find(
            (membership) => membership.organizationId === activeTenantId,
          )?.tenantName ||
          null
        : null;

    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      role: context.effectiveRole,
      canonicalRole: accessProfile.canonicalRole,
      roleLabel: accessProfile.canonicalRoleLabel,
      customRoleId: accessProfile.customRoleId,
      customRoleName: accessProfile.customRoleName,
      permissions: accessProfile.permissions,
      providerId: user.providerId,
      name: user.name,
      status: user.status,
      region: user.region,
      zoneId: user.zoneId,
      ownerCapability: user.ownerCapability,
      tenantId: activeTenantId,
      activeTenantId,
      organizationId: activeOrganizationId,
      orgId: activeOrganizationId,
      activeOrganizationId,
      organizationName: activeTenantName,
      activeTenantName,
      scopeDisplayName: this.resolveScopeDisplayName(accessProfile.scope.type, {
        activeOrganizationName: activeTenantName,
        activeStationName: context.activeStationContext?.stationName || null,
      }),
      activeStationName: context.activeStationContext?.stationName || null,
      sessionScopeType: context.sessionScopeType,
      actingAsTenant: context.actingAsTenant,
      selectedTenantId: context.selectedTenantId,
      selectedTenantName: context.selectedTenantName,
      memberships: membershipSummaries,
      availableTenants: membershipSummaries,
      stationContexts: context.stationContexts,
      activeStationContext: context.activeStationContext,
      accessProfile,
      mustChangePassword: Boolean(user.mustChangePassword),
      twoFactorEnabled: Boolean(user.twoFactorEnabled),
      mfaRequired: Boolean(user.mfaRequired),
      mfaSetupRequired:
        !Boolean(user.mfaRequired) && !Boolean(user.twoFactorEnabled),
    };
  }

  private async issueTokens(
    user: AuthUserContextInput,
    options?: AuthSessionContextOptions,
  ) {
    const secret = this.config.get<string>('JWT_SECRET');
    if (!secret) {
      throw new Error('JWT_SECRET not configured');
    }

    const context = await this.buildAuthUserContext(user, options);
    const authenticatedUser = this.buildAuthenticatedUserPayload(user, context);

    const accessToken = jwt.sign(
      {
        sub: user.id,
        email: user.email,
        role: context.effectiveRole,
        canonicalRole: authenticatedUser.canonicalRole,
        permissions: authenticatedUser.permissions,
        tenantId: authenticatedUser.tenantId,
        activeTenantId: authenticatedUser.activeTenantId,
        organizationId: authenticatedUser.organizationId,
        activeOrganizationId: authenticatedUser.activeOrganizationId,
        sessionScopeType: authenticatedUser.sessionScopeType,
        actingAsTenant: authenticatedUser.actingAsTenant,
        selectedTenantId: authenticatedUser.selectedTenantId,
        selectedTenantName: authenticatedUser.selectedTenantName,
      },
      secret as jwt.Secret,
      {
        expiresIn: (this.config.get<string>('JWT_ACCESS_EXPIRY') ||
          '15m') as SignOptions['expiresIn'],
      } as SignOptions,
    );

    const refreshToken = jwt.sign(
      {
        sub: user.id,
        type: 'refresh',
        jti: crypto.randomUUID(),
        sessionScopeType: authenticatedUser.sessionScopeType,
        actingAsTenant: authenticatedUser.actingAsTenant,
        selectedTenantId: authenticatedUser.selectedTenantId,
        selectedTenantName: authenticatedUser.selectedTenantName,
      },
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
      user: authenticatedUser,
    };
  }

  async refresh(refreshToken: string, context?: AuthMonitoringContext) {
    const startTime = Date.now();
    const secret = this.config.get<string>('JWT_SECRET');
    const monitoringContext = this.createMonitoringContext(context, 'refresh');

    try {
      if (!secret) throw new Error('JWT_SECRET not configured');

      let payload: AuthRefreshTokenClaims;
      try {
        const verified = jwt.verify(refreshToken, secret);
        if (
          !verified ||
          typeof verified !== 'object' ||
          Array.isArray(verified) ||
          typeof verified.sub !== 'string'
        ) {
          throw new UnauthorizedException('Invalid token');
        }
        payload = verified as AuthRefreshTokenClaims;
      } catch {
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
      const authUserContext = await this.buildAuthUserContext(user, {
        sessionScopeType: payload.sessionScopeType,
        actingAsTenant: payload.actingAsTenant,
        selectedTenantId: payload.selectedTenantId || null,
        selectedTenantName: payload.selectedTenantName || null,
      });
      const authenticatedUser = this.buildAuthenticatedUserPayload(
        user,
        authUserContext,
      );

      const accessToken = jwt.sign(
        {
          sub: user.id,
          email: user.email,
          role: authUserContext.effectiveRole,
          canonicalRole: authenticatedUser.canonicalRole,
          permissions: authenticatedUser.permissions,
          tenantId: authenticatedUser.tenantId,
          activeTenantId: authenticatedUser.activeTenantId,
          organizationId: authenticatedUser.organizationId,
          activeOrganizationId: authenticatedUser.activeOrganizationId,
          sessionScopeType: authenticatedUser.sessionScopeType,
          actingAsTenant: authenticatedUser.actingAsTenant,
          selectedTenantId: authenticatedUser.selectedTenantId,
          selectedTenantName: authenticatedUser.selectedTenantName,
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
        user: authenticatedUser,
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

    const where: Prisma.UserWhereInput = {};
    if (params.search) {
      where.OR = [
        { name: { contains: params.search, mode: 'insensitive' } },
        { email: { contains: params.search, mode: 'insensitive' } },
      ];
    }
    if (params.role) {
      where.role = params.role as UserRole;
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
      const existingAndFilters = Array.isArray(where.AND)
        ? where.AND
        : where.AND
          ? [where.AND]
          : [];
      where.AND = [
        ...existingAndFilters,
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

  async findTeamMembers(
    actorId: string,
    sessionScope?: SessionTenantScopeOptions,
  ) {
    const scope = await this.getTeamManagerScope(actorId, sessionScope);

    const memberships = await this.prisma.organizationMembership.findMany({
      where: {
        organizationId: scope.organizationId,
        status: {
          in: [
            MembershipStatus.ACTIVE,
            MembershipStatus.INVITED,
            MembershipStatus.SUSPENDED,
          ],
        },
      },
      include: {
        user: {
          select: this.userSafeSelect,
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    const userIds = memberships.map((membership) => membership.userId);
    if (userIds.length === 0) {
      return [];
    }

    const assignmentRows = await this.prisma.stationTeamAssignment.findMany({
      where: {
        userId: { in: userIds },
        isActive: true,
        station: {
          orgId: scope.organizationId,
        },
      },
      select: {
        userId: true,
      },
    });

    const payoutProfiles = await this.prisma.staffPayoutProfile.findMany({
      where: {
        userId: { in: userIds },
      },
      select: {
        userId: true,
      },
    });

    const assignmentCountByUser = assignmentRows.reduce((acc, row) => {
      acc.set(row.userId, (acc.get(row.userId) || 0) + 1);
      return acc;
    }, new Map<string, number>());
    const payoutProfileUserIds = new Set(
      payoutProfiles.map((profile) => profile.userId),
    );

    return memberships.map((membership) => {
      const user = membership.user;
      const activeAssignments = assignmentCountByUser.get(user.id) || 0;
      const displayStatus =
        user.status === 'Active' &&
        this.requiresStationAssignments(membership.role) &&
        activeAssignments === 0
          ? 'Active-Unassigned'
          : user.status;

      return {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: membership.role,
        customRoleId: membership.customRoleId,
        customRoleName: membership.customRoleName,
        status: user.status,
        displayStatus,
        ownerCapability: membership.ownerCapability || user.ownerCapability,
        activeAssignments,
        hasPayoutProfile: payoutProfileUserIds.has(user.id),
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      };
    });
  }

  async inviteTeamMember(
    inviteDto: TeamInviteUserDto,
    inviterId: string,
    sessionScope?: SessionTenantScopeOptions,
  ) {
    const scope = await this.getTeamManagerScope(inviterId, sessionScope);
    const inviteRole = this.parseUserRole(
      inviteDto.role as string,
      'team invite',
    );
    this.assertTeamManageableRole(inviteRole, 'team invite');
    this.assertCanAssignEvzoneRole(
      scope.managerRole,
      inviteRole,
      'team invite',
    );

    let normalizedAssignments: Array<{
      stationId: string;
      role: UserRole;
      isPrimary: boolean;
      isActive: boolean;
      attendantMode: AttendantRoleMode | null;
      shiftStart: string | null;
      shiftEnd: string | null;
      timezone: string | null;
    }> = [];

    if (this.requiresStationAssignments(inviteRole)) {
      if (!inviteDto.initialAssignments?.length) {
        throw new BadRequestException(
          `At least one station assignment is required for role "${inviteRole}"`,
        );
      }

      normalizedAssignments = this.normalizeTeamAssignments(
        inviteDto.initialAssignments,
        'team invite',
      );

      await this.validateStationsInOrganizationScope(
        normalizedAssignments.map((assignment) => assignment.stationId),
        scope.organizationId,
      );
    }

    const invitePayload: InviteUserDto = {
      ...inviteDto,
      role: inviteRole as unknown as InviteUserDto['role'],
      initialAssignments: normalizedAssignments.length
        ? (normalizedAssignments as unknown as TeamStationAssignmentDto[])
        : undefined,
    };

    return this.inviteUser(invitePayload, inviterId);
  }

  async updateTeamMember(
    targetUserId: string,
    updateDto: UpdateUserDto,
    actorId: string,
    sessionScope?: SessionTenantScopeOptions,
  ) {
    const scope = await this.getTeamManagerScope(actorId, sessionScope);
    const target = await this.ensureTeamMemberInScope(
      targetUserId,
      scope.organizationId,
    );

    const updateData: Prisma.UserUpdateInput = {};
    const membershipUpdateData: Prisma.OrganizationMembershipUpdateInput = {};
    if (typeof updateDto.name === 'string') updateData.name = updateDto.name;
    if (typeof updateDto.phone === 'string') updateData.phone = updateDto.phone;
    if (typeof updateDto.status === 'string')
      updateData.status = updateDto.status;
    if (typeof updateDto.ownerCapability === 'string') {
      updateData.ownerCapability =
        updateDto.ownerCapability as unknown as StationOwnerCapability;
      membershipUpdateData.ownerCapability =
        (updateDto.ownerCapability as StationOwnerCapability | null) || null;
    }
    if (typeof updateDto.role === 'string') {
      const parsedRole = this.parseUserRole(
        updateDto.role,
        'team member update',
      );
      this.assertTeamManageableRole(parsedRole, 'team member update');
      this.assertCanAssignEvzoneRole(
        scope.managerRole,
        parsedRole,
        'team member update',
      );
      updateData.role = parsedRole;
      membershipUpdateData.role = parsedRole;
      membershipUpdateData.canonicalRoleKey =
        resolveCanonicalRoleKey(parsedRole);
      if (!updateDto.customRoleId) {
        membershipUpdateData.customRoleId = null;
        membershipUpdateData.customRoleName = null;
      }
    }
    if (typeof updateDto.customRoleId === 'string') {
      membershipUpdateData.customRoleId = updateDto.customRoleId || null;
    }
    if (typeof updateDto.customRoleName === 'string') {
      membershipUpdateData.customRoleName = updateDto.customRoleName || null;
    }
    if (updateDto.status) {
      membershipUpdateData.status =
        updateDto.status === 'Active'
          ? MembershipStatus.ACTIVE
          : updateDto.status === 'Invited' || updateDto.status === 'Pending'
            ? MembershipStatus.INVITED
            : MembershipStatus.SUSPENDED;
    }

    if (
      Object.keys(updateData).length === 0 &&
      Object.keys(membershipUpdateData).length === 0
    ) {
      throw new BadRequestException('No supported fields provided for update');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const mappedMembershipStatus =
        updateDto.status === 'Active'
          ? MembershipStatus.ACTIVE
          : updateDto.status === 'Invited' || updateDto.status === 'Pending'
            ? MembershipStatus.INVITED
            : updateDto.status
              ? MembershipStatus.SUSPENDED
              : undefined;
      const resolvedOwnerCapability =
        typeof updateDto.ownerCapability === 'string'
          ? (updateDto.ownerCapability as unknown as StationOwnerCapability)
          : target.ownerCapability || null;

      const updatedUser =
        Object.keys(updateData).length > 0
          ? await tx.user.update({
              where: { id: targetUserId },
              data: updateData,
              select: this.userSafeSelect,
            })
          : await tx.user.findUniqueOrThrow({
              where: { id: targetUserId },
              select: this.userSafeSelect,
            });

      const membership = await tx.organizationMembership.findUnique({
        where: {
          userId_organizationId: {
            userId: targetUserId,
            organizationId: scope.organizationId,
          },
        },
      });

      if (membership) {
        if (Object.keys(membershipUpdateData).length > 0) {
          await tx.organizationMembership.update({
            where: {
              userId_organizationId: {
                userId: targetUserId,
                organizationId: scope.organizationId,
              },
            },
            data: membershipUpdateData,
          });
        }
      }

      if (updateData.role) {
        await this.enforceEvzoneOrganizationAssignment(
          {
            userId: targetUserId,
            role: updateData.role as UserRole,
            ownerCapability: resolvedOwnerCapability,
            membershipStatus:
              mappedMembershipStatus ||
              membership?.status ||
              MembershipStatus.ACTIVE,
            customRoleId:
              typeof updateDto.customRoleId === 'string'
                ? updateDto.customRoleId
                : null,
            customRoleName:
              typeof updateDto.customRoleName === 'string'
                ? updateDto.customRoleName
                : null,
          },
          tx,
        );
      }

      if (
        updateData.role &&
        !this.requiresStationAssignments(updateData.role as UserRole)
      ) {
        await tx.stationTeamAssignment.updateMany({
          where: {
            userId: targetUserId,
            station: {
              orgId: scope.organizationId,
            },
            isActive: true,
          },
          data: {
            isActive: false,
            isPrimary: false,
          },
        });
        await tx.user.update({
          where: { id: targetUserId },
          data: {
            lastStationAssignmentId: null,
          },
        });
      }

      return updatedUser;
    });

    await this.recordAuditEvent({
      actor: actorId,
      action: 'TEAM_MEMBER_UPDATED',
      resource: 'User',
      resourceId: target.id,
      details: {
        targetUserId,
        organizationId: scope.organizationId,
      },
    });

    return result;
  }

  async getTeamAssignments(
    targetUserId: string,
    actorId: string,
    sessionScope?: SessionTenantScopeOptions,
  ) {
    const scope = await this.getTeamManagerScope(actorId, sessionScope);
    const target = await this.ensureTeamMemberInScope(
      targetUserId,
      scope.organizationId,
    );

    const assignments = await this.prisma.stationTeamAssignment.findMany({
      where: {
        userId: targetUserId,
        station: {
          orgId: scope.organizationId,
        },
      },
      include: {
        station: {
          select: {
            id: true,
            name: true,
            status: true,
          },
        },
      },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });

    return {
      userId: target.id,
      assignments: assignments.map((assignment) => ({
        id: assignment.id,
        stationId: assignment.stationId,
        stationName: assignment.station?.name || null,
        stationStatus: assignment.station?.status || null,
        role: assignment.role,
        isPrimary: assignment.isPrimary,
        isActive: assignment.isActive,
        attendantMode: assignment.attendantMode,
        shiftStart: assignment.shiftStart,
        shiftEnd: assignment.shiftEnd,
        timezone: assignment.timezone,
        createdAt: assignment.createdAt,
        updatedAt: assignment.updatedAt,
      })),
    };
  }

  async replaceTeamAssignments(
    targetUserId: string,
    assignments: TeamStationAssignmentDto[],
    actorId: string,
    sessionScope?: SessionTenantScopeOptions,
  ) {
    const scope = await this.getTeamManagerScope(actorId, sessionScope);
    await this.ensureTeamMemberInScope(targetUserId, scope.organizationId);

    const normalizedAssignments = this.normalizeTeamAssignments(
      assignments,
      'team assignment update',
    );
    await this.validateStationsInOrganizationScope(
      normalizedAssignments.map((assignment) => assignment.stationId),
      scope.organizationId,
    );

    await this.prisma.$transaction(async (tx) => {
      const organizationStationIds = (
        await tx.station.findMany({
          where: { orgId: scope.organizationId },
          select: { id: true },
        })
      ).map((station) => station.id);

      if (organizationStationIds.length === 0) {
        throw new BadRequestException(
          'Cannot update assignments: no stations found in organization',
        );
      }

      await tx.stationTeamAssignment.updateMany({
        where: {
          userId: targetUserId,
          stationId: { in: organizationStationIds },
          isActive: true,
        },
        data: {
          isActive: false,
          isPrimary: false,
        },
      });

      const createdAssignments: Array<{
        id: string;
        isPrimary: boolean;
        isActive: boolean;
      }> = [];
      for (const assignment of normalizedAssignments) {
        const created = await tx.stationTeamAssignment.create({
          data: {
            userId: targetUserId,
            stationId: assignment.stationId,
            role: assignment.role,
            isPrimary: assignment.isPrimary,
            isActive: assignment.isActive,
            assignedByUserId: actorId,
            attendantMode: assignment.attendantMode,
            shiftStart: assignment.shiftStart,
            shiftEnd: assignment.shiftEnd,
            timezone: assignment.timezone,
          },
          select: {
            id: true,
            isPrimary: true,
            isActive: true,
          },
        });
        createdAssignments.push(created);
      }

      const preferredContext =
        createdAssignments.find(
          (assignment) => assignment.isPrimary && assignment.isActive,
        ) ||
        createdAssignments.find((assignment) => assignment.isActive) ||
        null;

      await tx.user.update({
        where: { id: targetUserId },
        data: {
          lastStationAssignmentId: preferredContext?.id || null,
        },
      });

      await this.syncAttendantProjectionForUser(targetUserId, tx);
    });

    await this.recordAuditEvent({
      actor: actorId,
      action: 'TEAM_ASSIGNMENTS_REPLACED',
      resource: 'StationTeamAssignment',
      resourceId: targetUserId,
      details: {
        targetUserId,
        organizationId: scope.organizationId,
        assignmentCount: assignments.length,
      },
    });

    return this.getTeamAssignments(targetUserId, actorId, sessionScope);
  }

  async getStaffPayoutProfile(
    targetUserId: string,
    actorId: string,
    sessionScope?: SessionTenantScopeOptions,
  ) {
    const scope = await this.getTeamManagerScope(actorId, sessionScope);
    await this.ensureTeamMemberInScope(targetUserId, scope.organizationId);

    return this.prisma.staffPayoutProfile.findUnique({
      where: {
        userId: targetUserId,
      },
    });
  }

  async upsertStaffPayoutProfile(
    targetUserId: string,
    payoutDto: StaffPayoutProfileDto,
    actorId: string,
    sessionScope?: SessionTenantScopeOptions,
  ) {
    const scope = await this.getTeamManagerScope(actorId, sessionScope);
    await this.ensureTeamMemberInScope(targetUserId, scope.organizationId);
    this.validatePayoutProfileInput(payoutDto);

    const profile = await this.prisma.staffPayoutProfile.upsert({
      where: {
        userId: targetUserId,
      },
      update: {
        method: payoutDto.method,
        beneficiaryName: payoutDto.beneficiaryName,
        providerName: payoutDto.providerName || null,
        bankName: payoutDto.bankName || null,
        accountNumber: payoutDto.accountNumber || null,
        phoneNumber: payoutDto.phoneNumber || null,
        currency: payoutDto.currency || 'UGX',
        isActive: payoutDto.isActive ?? true,
        updatedByUserId: actorId,
      },
      create: {
        userId: targetUserId,
        method: payoutDto.method,
        beneficiaryName: payoutDto.beneficiaryName,
        providerName: payoutDto.providerName || null,
        bankName: payoutDto.bankName || null,
        accountNumber: payoutDto.accountNumber || null,
        phoneNumber: payoutDto.phoneNumber || null,
        currency: payoutDto.currency || 'UGX',
        isActive: payoutDto.isActive ?? true,
        createdByUserId: actorId,
        updatedByUserId: actorId,
      },
    });

    await this.recordAuditEvent({
      actor: actorId,
      action: 'STAFF_PAYOUT_PROFILE_UPSERTED',
      resource: 'StaffPayoutProfile',
      resourceId: profile.id,
      details: {
        targetUserId,
        organizationId: scope.organizationId,
      },
    });

    return profile;
  }

  async getUserStationContexts(
    userId: string,
    sessionScope?: SessionTenantScopeOptions,
  ) {
    if (!userId) {
      throw new UnauthorizedException('Authenticated user context is required');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        ...this.userSafeSelect,
        organization: {
          select: this.organizationSafeSelect,
        },
      },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const context = await this.buildAuthUserContext(user, {
      sessionScopeType: sessionScope?.sessionScopeType,
      actingAsTenant: sessionScope?.actingAsTenant,
      selectedTenantId: sessionScope?.selectedTenantId || null,
    });

    return this.resolveStationContexts(
      user.id,
      context.activeOrganizationId,
      user.lastStationAssignmentId,
    );
  }

  async switchUserStationContext(
    userId: string,
    assignmentId: string,
    sessionScope?: SessionTenantScopeOptions,
  ) {
    if (!userId) {
      throw new UnauthorizedException('Authenticated user context is required');
    }
    if (!assignmentId) {
      throw new BadRequestException('assignmentId is required');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        ...this.userSafeSelect,
        organization: {
          select: this.organizationSafeSelect,
        },
      },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const context = await this.buildAuthUserContext(user, {
      sessionScopeType: sessionScope?.sessionScopeType,
      actingAsTenant: sessionScope?.actingAsTenant,
      selectedTenantId: sessionScope?.selectedTenantId || null,
    });
    const activeOrganizationId = context.activeOrganizationId;
    if (!activeOrganizationId) {
      throw new UnauthorizedException(
        'Active tenant scope is required before switching station context',
      );
    }

    const assignment = await this.prisma.stationTeamAssignment.findFirst({
      where: {
        id: assignmentId,
        userId,
        isActive: true,
        station: {
          orgId: activeOrganizationId,
        },
      },
      include: {
        station: {
          select: {
            id: true,
            orgId: true,
          },
        },
      },
    });

    if (!assignment) {
      throw new UnauthorizedException(
        'Assignment is invalid, inactive, or outside your active organization context',
      );
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        lastStationAssignmentId: assignment.id,
      },
    });

    const contexts = await this.resolveStationContexts(
      user.id,
      activeOrganizationId,
      assignment.id,
    );

    await this.recordAuditEvent({
      actor: userId,
      action: 'STATION_CONTEXT_SWITCHED',
      resource: 'StationTeamAssignment',
      resourceId: assignment.id,
      details: {
        stationId: assignment.stationId,
      },
    });

    return contexts;
  }

  async getCrmStats() {
    const [total, active, settledRevenue] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({
        where: { status: 'Active' },
      }),
      this.prisma.paymentIntent.aggregate({
        where: {
          status: 'SETTLED',
          currency: 'USD',
        },
        _sum: {
          amount: true,
        },
      }),
    ]);

    const totalRevenue = Number((settledRevenue._sum.amount || 0).toFixed(2));

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

  async getCurrentUser(id: string, sessionOptions?: AuthSessionContextOptions) {
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

    const authUserContext = await this.buildAuthUserContext(
      user,
      sessionOptions,
    );
    const authenticatedUser = this.buildAuthenticatedUserPayload(
      user,
      authUserContext,
    );

    return {
      ...user,
      ...authenticatedUser,
      organization: user.organization,
      memberships: authenticatedUser.memberships,
      stationContexts: authenticatedUser.stationContexts,
      activeStationContext: authenticatedUser.activeStationContext,
    };
  }

  async getCurrentAccessProfile(
    id: string,
    sessionOptions?: AuthSessionContextOptions,
  ) {
    const user = await this.getCurrentUser(id, sessionOptions);
    return user?.accessProfile || null;
  }

  async updateUser(id: string, updateDto: UpdateUserDto) {
    try {
      if (typeof updateDto.role === 'string') {
        throw new BadRequestException(
          'Role changes are not allowed via this endpoint; use team management invite/update flows',
        );
      }

      const safeUpdateDto: Prisma.UserUpdateInput = {};
      if (typeof updateDto.name === 'string')
        safeUpdateDto.name = updateDto.name;
      if (typeof updateDto.phone === 'string')
        safeUpdateDto.phone = updateDto.phone;
      if (typeof updateDto.country === 'string')
        safeUpdateDto.country = updateDto.country;
      if (typeof updateDto.ownerCapability === 'string') {
        safeUpdateDto.ownerCapability =
          updateDto.ownerCapability as unknown as StationOwnerCapability;
      }
      if (typeof updateDto.status === 'string') {
        safeUpdateDto.status = updateDto.status;
      }

      const updated = await this.prisma.user.update({
        where: { id },
        data: safeUpdateDto,
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

  private async syncOcpiTokenSafe(user: AuthUserContextInput) {
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

    // Mark email as verified and activate the account for onboarding actions.
    const user = await this.prisma.user.update({
      where: { id: verificationToken.userId },
      data: {
        emailVerifiedAt: new Date(),
        status: 'Active',
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
          {
            userId: user.id,
            zoneId: user.zoneId,
            country: user.country,
            region: user.region,
          },
        );
      }
    } catch (error) {
      this.logger.error(
        'Failed to send application received email',
        String(error).replace(/[\n\r]/g, ''),
      );
    }

    this.logger.log(`Email verified for user ${user.id}, account activated`);
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
      await this.mailService.sendVerificationEmail(email, token, undefined, {
        userId: user.id,
        zoneId: user.zoneId,
        country: user.country,
        region: user.region,
      });
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
        {
          userId: user.id,
          zoneId: user.zoneId,
          country: user.country,
          region: user.region,
        },
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
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { status: true },
    });
    if (!existing) {
      throw new NotFoundException('User not found');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        mfaRequired: required,
        status:
          required && existing.status === 'Active'
            ? 'MfaRequired'
            : !required && existing.status === 'MfaRequired'
              ? 'Active'
              : existing.status,
      },
    });
  }

  async generatePasskeyLoginOptions(
    input: PasskeyLoginOptionsDto,
    context?: AuthMonitoringContext,
  ): Promise<{
    challengeId: string;
    options: PublicKeyCredentialRequestOptionsJSON;
    expiresAt: string;
  }> {
    const { email, phone } = this.resolveLoginIdentifiers({
      email: input.email,
      phone: input.phone,
      password: 'unused',
    });
    const monitoringContext = this.createMonitoringContext(
      context,
      'passkey_login_options',
      email || phone,
    );

    try {
      if (!email && !phone) {
        throw new BadRequestException('Email or phone is required');
      }

      const user = await this.findUserForLogin(email, phone);
      if (!user) {
        throw new UnauthorizedException('Invalid credentials');
      }

      const passkeys = await this.prisma.passkeyCredential.findMany({
        where: { userId: user.id },
        select: {
          credentialId: true,
          transports: true,
        },
      });
      if (passkeys.length === 0) {
        throw new BadRequestException(
          'No passkey is enrolled for this account',
        );
      }

      const expectedOrigins = this.resolveWebAuthnExpectedOrigins();
      const rpId = this.resolveWebAuthnRpId(expectedOrigins);
      const options = await generateAuthenticationOptions({
        rpID: rpId,
        userVerification: 'required',
        allowCredentials: passkeys.map((passkey) => ({
          id: passkey.credentialId,
          transports: this.normalizeAuthenticatorTransports(passkey.transports),
        })),
      });

      const challenge = await this.createMfaChallenge({
        userId: user.id,
        challenge: options.challenge,
        purpose: this.webauthnPurposes.passkeyLogin,
        relyingPartyId: rpId,
        context: monitoringContext,
      });

      this.anomalyMonitor.recordSuccess(monitoringContext);
      return {
        challengeId: challenge.id,
        options,
        expiresAt: challenge.expiresAt.toISOString(),
      };
    } catch (error) {
      this.anomalyMonitor.recordFailure(
        monitoringContext,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  async verifyPasskeyLogin(
    challengeId: string,
    responsePayload: Record<string, unknown>,
    context?: AuthMonitoringContext,
  ) {
    const monitoringContext = this.createMonitoringContext(
      context,
      'passkey_login_verify',
    );

    try {
      const challenge = await this.getActiveMfaChallenge(
        challengeId,
        this.webauthnPurposes.passkeyLogin,
      );
      if (!challenge.userId) {
        throw new UnauthorizedException('Challenge is not bound to a user');
      }
      const challengeUserId = challenge.userId;

      const response = this.parseAuthenticationResponsePayload(responsePayload);
      const credential = await this.prisma.passkeyCredential.findFirst({
        where: {
          userId: challengeUserId,
          credentialId: response.id,
        },
      });
      if (!credential) {
        throw new UnauthorizedException('Credential not recognized');
      }

      const verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: this.resolveWebAuthnExpectedOrigins(),
        expectedRPID: challenge.relyingPartyId,
        credential: this.toWebAuthnCredential(credential),
      });
      if (!verification.verified) {
        throw new UnauthorizedException('Passkey verification failed');
      }

      await this.prisma.$transaction(async (tx) => {
        await tx.passkeyCredential.update({
          where: { id: credential.id },
          data: {
            counter: verification.authenticationInfo.newCounter,
            lastUsedAt: new Date(),
          },
        });
        await tx.user.update({
          where: { id: challengeUserId },
          data: { mfaRequired: true },
        });
        await tx.mfaChallenge.update({
          where: { id: challenge.id },
          data: { consumedAt: new Date() },
        });
      });

      const user = await this.prisma.user.findUnique({
        where: { id: challengeUserId },
      });
      if (!user) {
        throw new UnauthorizedException('User not found');
      }

      await this.recordAuditEvent({
        actor: user.id,
        action: 'PASSKEY_LOGIN_SUCCEEDED',
        resource: 'User',
        resourceId: user.id,
        details: {
          credentialId: credential.credentialId,
        },
      });

      const authResponse = await this.generateAuthResponse(user);
      this.anomalyMonitor.recordSuccess(monitoringContext);
      return authResponse;
    } catch (error) {
      this.anomalyMonitor.recordFailure(
        monitoringContext,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  async generatePasskeyRegistrationOptions(
    userId: string,
    input: { currentPassword: string; twoFactorToken?: string },
  ): Promise<{
    challengeId: string;
    options: PublicKeyCredentialCreationOptionsJSON;
    expiresAt: string;
  }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        phone: true,
        name: true,
        passwordHash: true,
        twoFactorEnabled: true,
        twoFactorSecret: true,
      },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.assertCurrentPasswordForTwoFactor(user, input.currentPassword);
    if (user.twoFactorEnabled) {
      const providedToken = input.twoFactorToken?.trim();
      if (!providedToken) {
        throw new BadRequestException(
          'twoFactorToken is required when 2FA is enabled',
        );
      }
      this.verifyTotpForUser(
        user.id,
        user.twoFactorSecret,
        providedToken,
        'sensitive',
      );
    }

    const passkeys = await this.prisma.passkeyCredential.findMany({
      where: { userId: user.id },
      select: {
        credentialId: true,
        transports: true,
      },
    });

    const expectedOrigins = this.resolveWebAuthnExpectedOrigins();
    const rpId = this.resolveWebAuthnRpId(expectedOrigins);
    const options = await generateRegistrationOptions({
      rpName: this.resolveWebAuthnRpName(),
      rpID: rpId,
      userName: user.email || user.phone || `user-${user.id}`,
      userDisplayName: user.name,
      userID: Buffer.from(user.id, 'utf8'),
      attestationType: 'none',
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'required',
      },
      excludeCredentials: passkeys.map((passkey) => ({
        id: passkey.credentialId,
        transports: this.normalizeAuthenticatorTransports(passkey.transports),
      })),
    });

    const challenge = await this.createMfaChallenge({
      userId: user.id,
      challenge: options.challenge,
      purpose: this.webauthnPurposes.passkeyRegistration,
      relyingPartyId: rpId,
    });

    return {
      challengeId: challenge.id,
      options,
      expiresAt: challenge.expiresAt.toISOString(),
    };
  }

  async verifyPasskeyRegistration(
    userId: string,
    input: {
      challengeId: string;
      response: Record<string, unknown>;
      label?: string;
    },
  ): Promise<{
    success: boolean;
    passkey: {
      id: string;
      credentialId: string;
      label: string | null;
      deviceType: string | null;
      backedUp: boolean | null;
      transports: string[];
      createdAt: Date;
      lastUsedAt: Date | null;
    };
    recoveryCodes?: string[];
  }> {
    const challenge = await this.getActiveMfaChallenge(
      input.challengeId,
      this.webauthnPurposes.passkeyRegistration,
      userId,
    );
    const response = this.parseRegistrationResponsePayload(input.response);
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: this.resolveWebAuthnExpectedOrigins(),
      expectedRPID: challenge.relyingPartyId,
      requireUserVerification: true,
    });
    if (!verification.verified || !verification.registrationInfo) {
      throw new BadRequestException('Passkey registration verification failed');
    }

    const registrationInfo = verification.registrationInfo;
    const parsedLabel = this.normalizePasskeyLabel(input.label);
    const transports = this.normalizeAuthenticatorTransports(
      response.response.transports,
    );

    const passkey = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.passkeyCredential.findUnique({
        where: { credentialId: registrationInfo.credential.id },
      });
      if (existing && existing.userId !== userId) {
        throw new ConflictException(
          'This passkey is already registered to another account',
        );
      }

      const saved = await tx.passkeyCredential.upsert({
        where: { credentialId: registrationInfo.credential.id },
        create: {
          userId,
          credentialId: registrationInfo.credential.id,
          publicKey: isoBase64URL.fromBuffer(
            registrationInfo.credential.publicKey,
          ),
          counter: registrationInfo.credential.counter,
          transports: transports || [],
          aaguid: registrationInfo.aaguid,
          deviceType: registrationInfo.credentialDeviceType,
          backedUp: registrationInfo.credentialBackedUp,
          label: parsedLabel,
        },
        update: {
          publicKey: isoBase64URL.fromBuffer(
            registrationInfo.credential.publicKey,
          ),
          counter: registrationInfo.credential.counter,
          transports: transports || [],
          aaguid: registrationInfo.aaguid,
          deviceType: registrationInfo.credentialDeviceType,
          backedUp: registrationInfo.credentialBackedUp,
          label: parsedLabel ?? existing?.label ?? null,
          updatedAt: new Date(),
        },
        select: {
          id: true,
          credentialId: true,
          label: true,
          deviceType: true,
          backedUp: true,
          transports: true,
          createdAt: true,
          lastUsedAt: true,
        },
      });

      await tx.mfaChallenge.update({
        where: { id: challenge.id },
        data: { consumedAt: new Date() },
      });

      await tx.user.update({
        where: { id: userId },
        data: { mfaRequired: true },
      });

      return saved;
    });

    let recoveryCodes: string[] | undefined;
    const activeRecoveryCodeCount = await this.prisma.mfaRecoveryCode.count({
      where: { userId, usedAt: null },
    });
    if (activeRecoveryCodeCount === 0) {
      recoveryCodes = await this.replaceRecoveryCodes(userId);
    }

    const userForAlert = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        zoneId: true,
        country: true,
        region: true,
      },
    });
    await this.recordAuditEvent({
      actor: userId,
      action: 'PASSKEY_ENROLLED',
      resource: 'User',
      resourceId: userId,
      details: {
        credentialId: passkey.credentialId,
      },
    });
    await this.sendMfaSecurityAlert(
      userForAlert,
      'Passkey Added',
      'A passkey was added to your account.',
    );

    return {
      success: true,
      passkey: {
        id: passkey.id,
        credentialId: passkey.credentialId,
        label: passkey.label,
        deviceType: passkey.deviceType,
        backedUp: passkey.backedUp,
        transports: passkey.transports,
        createdAt: passkey.createdAt,
        lastUsedAt: passkey.lastUsedAt,
      },
      recoveryCodes,
    };
  }

  async listPasskeys(userId: string): Promise<
    Array<{
      id: string;
      credentialId: string;
      label: string | null;
      deviceType: string | null;
      backedUp: boolean | null;
      transports: string[];
      createdAt: Date;
      lastUsedAt: Date | null;
    }>
  > {
    const passkeys = await this.prisma.passkeyCredential.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        credentialId: true,
        label: true,
        deviceType: true,
        backedUp: true,
        transports: true,
        createdAt: true,
        lastUsedAt: true,
      },
    });

    return passkeys.map((passkey) => ({
      id: passkey.id,
      credentialId: passkey.credentialId,
      label: passkey.label,
      deviceType: passkey.deviceType,
      backedUp: passkey.backedUp,
      transports: passkey.transports,
      createdAt: passkey.createdAt,
      lastUsedAt: passkey.lastUsedAt,
    }));
  }

  async removePasskey(
    userId: string,
    credentialId: string,
    input: RemovePasskeyDto,
  ): Promise<{ success: boolean; message: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        passwordHash: true,
        twoFactorEnabled: true,
        twoFactorSecret: true,
        mfaRequired: true,
        zoneId: true,
        country: true,
        region: true,
      },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.assertCurrentPasswordForTwoFactor(user, input.currentPassword);
    await this.assertSensitiveActionMfa(
      user,
      'PASSKEY_REMOVAL',
      input,
      'Removing a passkey requires recent MFA verification',
    );

    const credential = await this.prisma.passkeyCredential.findFirst({
      where: {
        userId,
        credentialId,
      },
      select: {
        id: true,
        credentialId: true,
      },
    });
    if (!credential) {
      throw new NotFoundException('Passkey not found');
    }

    const passkeyCount = await this.prisma.passkeyCredential.count({
      where: { userId },
    });
    if (user.mfaRequired && !user.twoFactorEnabled && passkeyCount <= 1) {
      throw new BadRequestException(
        'Cannot remove the last MFA method while MFA is required',
      );
    }

    await this.prisma.passkeyCredential.delete({
      where: { id: credential.id },
    });

    await this.forceLogoutUser(userId);
    await this.recordAuditEvent({
      actor: userId,
      action: 'PASSKEY_REMOVED',
      resource: 'User',
      resourceId: userId,
      details: {
        credentialId: credential.credentialId,
      },
    });
    await this.sendMfaSecurityAlert(
      user,
      'Passkey Removed',
      'A passkey was removed from your account.',
    );

    return {
      success: true,
      message: 'Passkey removed successfully',
    };
  }

  async generatePasskeyStepUpOptions(userId: string): Promise<{
    challengeId: string;
    options: PublicKeyCredentialRequestOptionsJSON;
    expiresAt: string;
  }> {
    const passkeys = await this.prisma.passkeyCredential.findMany({
      where: { userId },
      select: {
        credentialId: true,
        transports: true,
      },
    });
    if (passkeys.length === 0) {
      throw new BadRequestException('No passkeys are enrolled for this user');
    }

    const expectedOrigins = this.resolveWebAuthnExpectedOrigins();
    const rpId = this.resolveWebAuthnRpId(expectedOrigins);
    const options = await generateAuthenticationOptions({
      rpID: rpId,
      userVerification: 'required',
      allowCredentials: passkeys.map((passkey) => ({
        id: passkey.credentialId,
        transports: this.normalizeAuthenticatorTransports(passkey.transports),
      })),
    });

    const challenge = await this.createMfaChallenge({
      userId,
      challenge: options.challenge,
      purpose: this.webauthnPurposes.passkeyStepUp,
      relyingPartyId: rpId,
    });

    return {
      challengeId: challenge.id,
      options,
      expiresAt: challenge.expiresAt.toISOString(),
    };
  }

  async verifyPasskeyStepUp(
    userId: string,
    challengeId: string,
    responsePayload: Record<string, unknown>,
  ): Promise<{ success: boolean; stepUpToken: string; expiresIn: string }> {
    const challenge = await this.getActiveMfaChallenge(
      challengeId,
      this.webauthnPurposes.passkeyStepUp,
      userId,
    );
    const response = this.parseAuthenticationResponsePayload(responsePayload);

    const credential = await this.prisma.passkeyCredential.findFirst({
      where: {
        userId,
        credentialId: response.id,
      },
    });
    if (!credential) {
      throw new UnauthorizedException('Credential not recognized');
    }

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: this.resolveWebAuthnExpectedOrigins(),
      expectedRPID: challenge.relyingPartyId,
      credential: this.toWebAuthnCredential(credential),
    });
    if (!verification.verified) {
      throw new UnauthorizedException('Passkey verification failed');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.passkeyCredential.update({
        where: { id: credential.id },
        data: {
          counter: verification.authenticationInfo.newCounter,
          lastUsedAt: new Date(),
        },
      });
      await tx.mfaChallenge.update({
        where: { id: challenge.id },
        data: { consumedAt: new Date() },
      });
    });

    await this.recordAuditEvent({
      actor: userId,
      action: 'MFA_STEP_UP_VERIFIED',
      resource: 'User',
      resourceId: userId,
      details: {
        method: 'passkey',
        credentialId: credential.credentialId,
      },
    });

    return {
      success: true,
      stepUpToken: this.issueStepUpToken(userId),
      expiresIn: this.stepUpTokenTtl,
    };
  }

  async regenerateRecoveryCodes(
    userId: string,
    input: RegenerateRecoveryCodesDto,
  ): Promise<{ success: boolean; recoveryCodes: string[] }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        passwordHash: true,
        twoFactorEnabled: true,
        twoFactorSecret: true,
        mfaRequired: true,
        zoneId: true,
        country: true,
        region: true,
      },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.assertCurrentPasswordForTwoFactor(user, input.currentPassword);
    await this.assertSensitiveActionMfa(
      user,
      'RECOVERY_CODES_REGENERATED',
      input,
      'Regenerating recovery codes requires recent MFA verification',
    );

    const recoveryCodes = await this.replaceRecoveryCodes(userId);

    await this.forceLogoutUser(userId);
    await this.recordAuditEvent({
      actor: userId,
      action: 'MFA_RECOVERY_CODES_REGENERATED',
      resource: 'User',
      resourceId: userId,
    });
    await this.sendMfaSecurityAlert(
      user,
      'Recovery Codes Regenerated',
      'Your account recovery codes were regenerated.',
    );

    return {
      success: true,
      recoveryCodes,
    };
  }

  private async enforceLoginMfa(user: User, loginDto: LoginDto): Promise<void> {
    const [passkeyCount, hasRecoveryCodes] = await Promise.all([
      this.prisma.passkeyCredential.count({
        where: { userId: user.id },
      }),
      this.hasActiveRecoveryCodes(user.id),
    ]);
    const hasPasskeys = passkeyCount > 0;
    const mfaEnforced =
      user.mfaRequired || user.twoFactorEnabled || hasPasskeys;
    const otpBackedMfa = user.mfaRequired && !user.twoFactorEnabled && !hasPasskeys;

    if (!mfaEnforced) {
      return;
    }

    const otpCode = loginDto.otpCode?.trim();
    if (otpCode) {
      if (!otpBackedMfa) {
        throw new UnauthorizedException(
          'OTP login is not enabled for this account',
        );
      }

      this.assertTwoFactorAttemptAllowed(user.id, 'login');
      try {
        await this.consumeUserOtpCode(user.id, otpCode);
      } catch (error) {
        this.registerTwoFactorFailure(user.id, 'login');
        throw error;
      }

      this.clearTwoFactorFailures(user.id, 'login');
      await this.recordAuditEvent({
        actor: user.id,
        action: 'MFA_OTP_USED',
        resource: 'User',
        resourceId: user.id,
        details: {
          context: 'login',
        },
      });
      return;
    }

    const twoFactorToken = loginDto.twoFactorToken?.trim();
    if (twoFactorToken) {
      if (!user.twoFactorEnabled) {
        throw new UnauthorizedException(
          'Two-factor authentication is not enabled for this account',
        );
      }
      this.verifyTotpForUser(
        user.id,
        user.twoFactorSecret,
        twoFactorToken,
        'login',
      );
      return;
    }

    const recoveryCode = loginDto.recoveryCode?.trim();
    if (recoveryCode) {
      this.assertTwoFactorAttemptAllowed(user.id, 'login');
      const consumed = await this.consumeRecoveryCode(user.id, recoveryCode);
      if (!consumed) {
        this.registerTwoFactorFailure(user.id, 'login');
        throw new UnauthorizedException('Invalid recovery code');
      }
      this.clearTwoFactorFailures(user.id, 'login');
      await this.recordAuditEvent({
        actor: user.id,
        action: 'MFA_RECOVERY_CODE_USED',
        resource: 'User',
        resourceId: user.id,
        details: {
          context: 'login',
        },
      });
      return;
    }

    if (otpBackedMfa) {
      const challenge = await this.sendOtpChallengeToUser(
        {
          id: user.id,
          email: user.email || null,
          phone: user.phone || null,
          zoneId: user.zoneId,
          country: user.country,
          region: user.region,
        },
        loginDto.otpChannel,
        'login',
      );

      throw new UnauthorizedException(
        `OTP verification is required. A code has been sent to your ${challenge.channel}.`,
      );
    }

    if (user.mfaRequired && !user.twoFactorEnabled && !hasPasskeys) {
      throw new UnauthorizedException(
        'MFA is required but no MFA method is enrolled for this account',
      );
    }

    if (hasPasskeys && !user.twoFactorEnabled) {
      throw new UnauthorizedException(
        hasRecoveryCodes
          ? 'Passkey verification is required. Use passkey login or a recovery code.'
          : 'Passkey verification is required. Use passkey login.',
      );
    }

    throw new UnauthorizedException('MFA token is required');
  }

  private resolveWebAuthnRpName(): string {
    return this.config.get<string>('APP_NAME') || 'EVZONE';
  }

  private parseCsvInput(value?: string | null): string[] {
    if (!value) return [];
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  private normalizeOrigin(candidate: string): string | null {
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return null;
      }
      return parsed.origin;
    } catch {
      return null;
    }
  }

  private resolveWebAuthnExpectedOrigins(): string[] {
    const configuredFrontend =
      this.config.get<string>('FRONTEND_URL') || process.env.FRONTEND_URL;
    const configuredCors =
      this.config.get<string>('CORS_ORIGINS') || process.env.CORS_ORIGINS;
    const defaults = ['http://localhost:5173'];
    const candidates = [
      ...(configuredFrontend ? [configuredFrontend] : []),
      ...this.parseCsvInput(configuredCors),
      ...defaults,
    ];

    const normalized = candidates
      .map((entry) => this.normalizeOrigin(entry))
      .filter((entry): entry is string => Boolean(entry));

    return Array.from(new Set(normalized));
  }

  private normalizeRpId(hostname: string): string {
    const normalized = hostname.trim().toLowerCase();
    if (
      normalized === '127.0.0.1' ||
      normalized === '[::1]' ||
      normalized === '::1'
    ) {
      return 'localhost';
    }
    return normalized || 'localhost';
  }

  private resolveWebAuthnRpId(origins?: string[]): string {
    const configuredFrontend =
      this.config.get<string>('FRONTEND_URL') || process.env.FRONTEND_URL;
    const preferredOrigin =
      (configuredFrontend && this.normalizeOrigin(configuredFrontend)) ||
      origins?.[0] ||
      'http://localhost:5173';
    const host = new URL(preferredOrigin).hostname;

    return this.normalizeRpId(host);
  }

  private normalizeAuthenticatorTransports(
    transports: unknown,
  ): AuthenticatorTransportFuture[] | undefined {
    if (!Array.isArray(transports)) {
      return undefined;
    }

    const normalized = transports
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter((entry): entry is AuthenticatorTransportFuture =>
        this.supportedAuthenticatorTransports.has(
          entry as AuthenticatorTransportFuture,
        ),
      );

    return normalized.length > 0 ? normalized : undefined;
  }

  private async createMfaChallenge(input: {
    userId?: string | null;
    challenge: string;
    purpose: string;
    relyingPartyId: string;
    context?: AuthMonitoringContext;
  }): Promise<{ id: string; expiresAt: Date }> {
    const expiresAt = new Date(Date.now() + this.mfaChallengeTtlMs);
    const created = await this.prisma.mfaChallenge.create({
      data: {
        userId: input.userId || null,
        challenge: input.challenge,
        purpose: input.purpose,
        relyingPartyId: input.relyingPartyId,
        expiresAt,
        ipAddress: input.context?.ip || null,
        userAgent: input.context?.userAgent || null,
      },
      select: {
        id: true,
        expiresAt: true,
      },
    });

    return created;
  }

  private async getActiveMfaChallenge(
    challengeId: string,
    purpose: string,
    userId?: string,
  ): Promise<{
    id: string;
    userId: string | null;
    challenge: string;
    purpose: string;
    relyingPartyId: string;
    expiresAt: Date;
    consumedAt: Date | null;
  }> {
    const challenge = await this.prisma.mfaChallenge.findUnique({
      where: { id: challengeId },
      select: {
        id: true,
        userId: true,
        challenge: true,
        purpose: true,
        relyingPartyId: true,
        expiresAt: true,
        consumedAt: true,
      },
    });
    if (!challenge) {
      throw new BadRequestException('Invalid MFA challenge');
    }
    if (challenge.purpose !== purpose) {
      throw new BadRequestException('MFA challenge purpose mismatch');
    }
    if (challenge.consumedAt) {
      throw new BadRequestException('MFA challenge has already been used');
    }
    if (challenge.expiresAt <= new Date()) {
      throw new BadRequestException('MFA challenge has expired');
    }
    if (userId && challenge.userId !== userId) {
      throw new ForbiddenException(
        'MFA challenge does not belong to this user',
      );
    }

    return challenge;
  }

  private toWebAuthnCredential(
    credential: Pick<
      PasskeyCredential,
      'credentialId' | 'publicKey' | 'counter' | 'transports'
    >,
  ): WebAuthnCredential {
    return {
      id: credential.credentialId,
      publicKey: isoBase64URL.toBuffer(credential.publicKey),
      counter: credential.counter,
      transports: this.normalizeAuthenticatorTransports(credential.transports),
    };
  }

  private isObjectRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private getRequiredStringField(
    source: Record<string, unknown>,
    key: string,
    errorMessage: string,
  ): string {
    const value = source[key];
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new BadRequestException(errorMessage);
    }
    return value;
  }

  private getOptionalStringField(
    source: Record<string, unknown>,
    key: string,
  ): string | undefined {
    const value = source[key];
    if (typeof value !== 'string') {
      return undefined;
    }
    return value.trim().length > 0 ? value : undefined;
  }

  private parseAuthenticationResponsePayload(
    payload: Record<string, unknown>,
  ): AuthenticationResponseJSON {
    if (!this.isObjectRecord(payload.response)) {
      throw new BadRequestException('Invalid authentication response payload');
    }

    const responsePayload = payload.response;
    const response: AuthenticatorAssertionResponseJSON = {
      clientDataJSON: this.getRequiredStringField(
        responsePayload,
        'clientDataJSON',
        'clientDataJSON is required',
      ),
      authenticatorData: this.getRequiredStringField(
        responsePayload,
        'authenticatorData',
        'authenticatorData is required',
      ),
      signature: this.getRequiredStringField(
        responsePayload,
        'signature',
        'signature is required',
      ),
    };
    const userHandle = this.getOptionalStringField(
      responsePayload,
      'userHandle',
    );
    if (userHandle) {
      response.userHandle = userHandle;
    }

    const type = this.getRequiredStringField(
      payload,
      'type',
      'credential type is required',
    );
    if (type !== 'public-key') {
      throw new BadRequestException('Unsupported credential type');
    }

    const clientExtensionResults = this.isObjectRecord(
      payload.clientExtensionResults,
    )
      ? (payload.clientExtensionResults as AuthenticationResponseJSON['clientExtensionResults'])
      : {};

    return {
      id: this.getRequiredStringField(
        payload,
        'id',
        'credential id is required',
      ),
      rawId: this.getRequiredStringField(
        payload,
        'rawId',
        'raw credential id is required',
      ),
      type: 'public-key',
      response,
      clientExtensionResults,
    };
  }

  private parseRegistrationResponsePayload(
    payload: Record<string, unknown>,
  ): RegistrationResponseJSON {
    if (!this.isObjectRecord(payload.response)) {
      throw new BadRequestException('Invalid registration response payload');
    }

    const responsePayload = payload.response;
    const response: AuthenticatorAttestationResponseJSON = {
      clientDataJSON: this.getRequiredStringField(
        responsePayload,
        'clientDataJSON',
        'clientDataJSON is required',
      ),
      attestationObject: this.getRequiredStringField(
        responsePayload,
        'attestationObject',
        'attestationObject is required',
      ),
    };
    const transports = this.normalizeAuthenticatorTransports(
      responsePayload.transports,
    );
    if (transports) {
      response.transports = transports;
    }

    const authenticatorData = this.getOptionalStringField(
      responsePayload,
      'authenticatorData',
    );
    if (authenticatorData) {
      response.authenticatorData = authenticatorData;
    }

    const publicKey = this.getOptionalStringField(responsePayload, 'publicKey');
    if (publicKey) {
      response.publicKey = publicKey;
    }

    const type = this.getRequiredStringField(
      payload,
      'type',
      'credential type is required',
    );
    if (type !== 'public-key') {
      throw new BadRequestException('Unsupported credential type');
    }

    const clientExtensionResults = this.isObjectRecord(
      payload.clientExtensionResults,
    )
      ? (payload.clientExtensionResults as RegistrationResponseJSON['clientExtensionResults'])
      : {};

    return {
      id: this.getRequiredStringField(
        payload,
        'id',
        'credential id is required',
      ),
      rawId: this.getRequiredStringField(
        payload,
        'rawId',
        'raw credential id is required',
      ),
      type: 'public-key',
      response,
      clientExtensionResults,
    };
  }

  private normalizePasskeyLabel(label?: string): string | null {
    if (!label) return null;
    const trimmed = label.trim();
    if (!trimmed) return null;
    return trimmed.slice(0, this.passkeyMaxLabelLength);
  }

  private normalizeRecoveryCodeInput(code: string): string {
    return code
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
  }

  private hashRecoveryCode(code: string): string {
    return crypto.createHash('sha256').update(`recovery:${code}`).digest('hex');
  }

  private generateRecoveryCode(): string {
    const value = crypto.randomBytes(5).toString('hex').toUpperCase();
    return `${value.slice(0, 5)}-${value.slice(5)}`;
  }

  private generateRecoveryCodeSet(count: number): string[] {
    const uniqueCodes = new Set<string>();
    while (uniqueCodes.size < count) {
      uniqueCodes.add(this.generateRecoveryCode());
    }
    return Array.from(uniqueCodes);
  }

  private async replaceRecoveryCodes(userId: string): Promise<string[]> {
    const recoveryCodes = this.generateRecoveryCodeSet(this.recoveryCodeCount);
    const records = recoveryCodes.map((code) => ({
      userId,
      codeHash: this.hashRecoveryCode(this.normalizeRecoveryCodeInput(code)),
    }));

    await this.prisma.$transaction(async (tx) => {
      await tx.mfaRecoveryCode.deleteMany({
        where: { userId },
      });
      await tx.mfaRecoveryCode.createMany({
        data: records,
      });
    });

    return recoveryCodes;
  }

  private async hasActiveRecoveryCodes(userId: string): Promise<boolean> {
    const count = await this.prisma.mfaRecoveryCode.count({
      where: { userId, usedAt: null },
    });
    return count > 0;
  }

  private async consumeRecoveryCode(
    userId: string,
    recoveryCode: string,
  ): Promise<boolean> {
    const normalizedCode = this.normalizeRecoveryCodeInput(recoveryCode);
    if (!normalizedCode) {
      return false;
    }

    const result = await this.prisma.mfaRecoveryCode.updateMany({
      where: {
        userId,
        codeHash: this.hashRecoveryCode(normalizedCode),
        usedAt: null,
      },
      data: {
        usedAt: new Date(),
      },
    });

    return result.count > 0;
  }

  private issueStepUpToken(userId: string): string {
    const secret = this.config.get<string>('JWT_SECRET');
    if (!secret) {
      throw new Error('JWT_SECRET not configured');
    }

    return jwt.sign(
      {
        sub: userId,
        type: 'mfa_step_up',
        jti: crypto.randomUUID(),
      },
      secret as jwt.Secret,
      {
        expiresIn: this.stepUpTokenTtl as SignOptions['expiresIn'],
      },
    );
  }

  private assertValidStepUpToken(userId: string, token: string): void {
    const secret = this.config.get<string>('JWT_SECRET');
    if (!secret) {
      throw new Error('JWT_SECRET not configured');
    }

    let decoded: jwt.JwtPayload & { sub?: string; type?: string };
    try {
      const verified = jwt.verify(token, secret);
      if (
        !verified ||
        typeof verified !== 'object' ||
        Array.isArray(verified)
      ) {
        throw new UnauthorizedException('Invalid step-up token');
      }
      decoded = verified as jwt.JwtPayload & { sub?: string; type?: string };
    } catch {
      throw new UnauthorizedException('Invalid or expired step-up token');
    }

    if (decoded.sub !== userId || decoded.type !== 'mfa_step_up') {
      throw new UnauthorizedException('Step-up token does not match this user');
    }
  }

  private verifyTotpForUser(
    userId: string,
    storedSecret: string | null,
    token: string,
    action: 'verify' | 'disable' | 'login' | 'sensitive',
  ): void {
    if (!storedSecret) {
      throw new UnauthorizedException('2FA is not enabled for this account');
    }

    this.assertTwoFactorAttemptAllowed(userId, action);
    const resolvedSecret = this.decryptTwoFactorSecret(storedSecret);
    const isValid = speakeasy.totp.verify({
      secret: resolvedSecret,
      encoding: 'base32',
      token,
      window: 1,
    });

    if (!isValid) {
      this.registerTwoFactorFailure(userId, action);
      throw new UnauthorizedException('Invalid MFA token');
    }

    this.clearTwoFactorFailures(userId, action);
  }

  private async assertSensitiveActionMfa(
    user: {
      id: string;
      mfaRequired: boolean;
      twoFactorEnabled: boolean;
      twoFactorSecret: string | null;
    },
    auditAction: string,
    input?: MfaConfirmationInput,
    missingProofMessage: string = 'Fresh MFA verification is required for this action',
  ): Promise<void> {
    const hasPasskeys =
      (await this.prisma.passkeyCredential.count({
        where: { userId: user.id },
      })) > 0;
    const mfaEnforced =
      user.mfaRequired || user.twoFactorEnabled || hasPasskeys;
    if (!mfaEnforced) {
      return;
    }

    const stepUpToken = input?.stepUpToken?.trim();
    if (stepUpToken) {
      this.assertValidStepUpToken(user.id, stepUpToken);
      return;
    }

    const twoFactorToken = input?.twoFactorToken?.trim();
    if (twoFactorToken) {
      if (!user.twoFactorEnabled) {
        throw new UnauthorizedException(
          'Two-factor authentication is not enabled for this account',
        );
      }
      this.verifyTotpForUser(
        user.id,
        user.twoFactorSecret,
        twoFactorToken,
        'sensitive',
      );
      return;
    }

    const recoveryCode = input?.recoveryCode?.trim();
    if (recoveryCode) {
      this.assertTwoFactorAttemptAllowed(user.id, 'sensitive');
      const consumed = await this.consumeRecoveryCode(user.id, recoveryCode);
      if (!consumed) {
        this.registerTwoFactorFailure(user.id, 'sensitive');
        throw new UnauthorizedException('Invalid recovery code');
      }
      this.clearTwoFactorFailures(user.id, 'sensitive');
      await this.recordAuditEvent({
        actor: user.id,
        action: 'MFA_RECOVERY_CODE_USED',
        resource: 'User',
        resourceId: user.id,
        details: {
          context: auditAction,
        },
      });
      return;
    }

    throw new UnauthorizedException(missingProofMessage);
  }

  private async sendMfaSecurityAlert(
    user: {
      id: string;
      email: string | null;
      name: string | null;
      zoneId?: string | null;
      country?: string | null;
      region?: string | null;
    } | null,
    subject: string,
    actionMessage: string,
  ): Promise<void> {
    if (!user?.email) return;

    const html = `
      <p>Hello ${user.name || 'there'},</p>
      <p>${actionMessage}</p>
      <p>Time: ${new Date().toISOString()}</p>
      <p>If this was not you, reset your password immediately and contact support.</p>
    `;

    try {
      await this.mailService.sendMail(user.email, subject, html, {
        userId: user.id,
        zoneId: user.zoneId,
        country: user.country,
        region: user.region,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to send MFA security alert (${subject})`,
        String(error).replace(/[\n\r]/g, ''),
      );
    }
  }

  // 2FA Methods

  private getTwoFactorAttemptKey(
    userId: string,
    action: 'verify' | 'disable' | 'login' | 'sensitive',
  ) {
    return `${userId}:${action}`;
  }

  private assertTwoFactorAttemptAllowed(
    userId: string,
    action: 'verify' | 'disable' | 'login' | 'sensitive',
  ) {
    const key = this.getTwoFactorAttemptKey(userId, action);
    const state = this.twoFactorAttempts.get(key);
    if (!state) return;

    const now = Date.now();
    if (state.lockedUntil > now) {
      const waitMinutes = Math.max(
        1,
        Math.ceil((state.lockedUntil - now) / 60_000),
      );
      throw new BadRequestException(
        `Too many failed 2FA attempts. Try again in ${waitMinutes} minute(s).`,
      );
    }

    if (now - state.lastFailedAt > this.twoFactorFailureWindowMs) {
      this.twoFactorAttempts.delete(key);
    }
  }

  private registerTwoFactorFailure(
    userId: string,
    action: 'verify' | 'disable' | 'login' | 'sensitive',
  ) {
    const key = this.getTwoFactorAttemptKey(userId, action);
    const now = Date.now();
    const current = this.twoFactorAttempts.get(key);
    const stale =
      !current || now - current.lastFailedAt > this.twoFactorFailureWindowMs;
    const failures = stale ? 1 : current.failures + 1;

    const lockedUntil =
      failures >= this.twoFactorMaxFailures ? now + this.twoFactorLockMs : 0;

    this.twoFactorAttempts.set(key, {
      failures,
      lastFailedAt: now,
      lockedUntil,
    });
  }

  private clearTwoFactorFailures(
    userId: string,
    action: 'verify' | 'disable' | 'login' | 'sensitive',
  ) {
    this.twoFactorAttempts.delete(this.getTwoFactorAttemptKey(userId, action));
  }

  private getTwoFactorEncryptionKey(): Buffer {
    const rawKey =
      this.config.get<string>('AUTH_2FA_ENCRYPTION_KEY') ||
      this.config.get<string>('JWT_SECRET') ||
      '';
    if (!rawKey) {
      throw new BadRequestException(
        '2FA encryption key is not configured on the server.',
      );
    }

    return crypto.createHash('sha256').update(rawKey).digest();
  }

  private encryptTwoFactorSecret(secret: string): string {
    const key = this.getTwoFactorEncryptionKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([
      cipher.update(secret, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return [
      this.twoFactorSecretPrefix,
      iv.toString('base64url'),
      encrypted.toString('base64url'),
      tag.toString('base64url'),
    ].join(':');
  }

  private decryptTwoFactorSecret(storedSecret: string): string {
    if (!storedSecret) return '';

    const expectedPrefix = `${this.twoFactorSecretPrefix}:`;
    if (!storedSecret.startsWith(expectedPrefix)) {
      return storedSecret;
    }

    const parts = storedSecret.split(':');
    if (parts.length !== 5) {
      throw new BadRequestException(
        'Stored 2FA secret is invalid. Re-enroll 2FA and try again.',
      );
    }

    const iv = Buffer.from(parts[2], 'base64url');
    const encrypted = Buffer.from(parts[3], 'base64url');
    const tag = Buffer.from(parts[4], 'base64url');
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      this.getTwoFactorEncryptionKey(),
      iv,
    );
    decipher.setAuthTag(tag);

    try {
      return Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new BadRequestException(
        'Stored 2FA secret is invalid. Re-enroll 2FA and try again.',
      );
    }
  }

  private normalizeLegacyBcryptPrefix(hash: string): string {
    const normalizedHash = hash.trim();
    if (
      normalizedHash.startsWith('$2y$') ||
      normalizedHash.startsWith('$2x$')
    ) {
      return `$2b$${normalizedHash.slice(4)}`;
    }
    return normalizedHash;
  }

  private isLikelyBcryptHash(hash: string): boolean {
    const normalizedHash = hash.trim();
    return (
      normalizedHash.startsWith('$2a$') ||
      normalizedHash.startsWith('$2b$') ||
      normalizedHash.startsWith('$2y$') ||
      normalizedHash.startsWith('$2x$')
    );
  }

  private isBcryptLikeHash(hash: string): boolean {
    const normalizedHash = hash.trim();
    return (
      this.isLikelyBcryptHash(normalizedHash) ||
      normalizedHash.startsWith('$2$')
    );
  }

  private getBcryptHashCandidates(hash: string): string[] {
    const normalizedHash = hash.trim();
    const candidates = new Set<string>([
      normalizedHash,
      this.normalizeLegacyBcryptPrefix(normalizedHash),
    ]);

    // Legacy `$2$` variant compatibility.
    if (normalizedHash.startsWith('$2$')) {
      candidates.add(`$2a$${normalizedHash.slice(3)}`);
      candidates.add(`$2b$${normalizedHash.slice(3)}`);
    }

    return Array.from(candidates).filter(Boolean);
  }

  private async comparePasswordWithLegacySupport(
    candidatePassword: string,
    storedHash: string,
  ): Promise<boolean> {
    const normalizedStoredHash = storedHash?.trim();
    if (!normalizedStoredHash) return false;

    if (this.isBcryptLikeHash(normalizedStoredHash)) {
      for (const hashCandidate of this.getBcryptHashCandidates(
        normalizedStoredHash,
      )) {
        try {
          if (await bcrypt.compare(candidatePassword, hashCandidate)) {
            return true;
          }
        } catch (error) {
          this.logger.warn(
            `Skipping invalid bcrypt hash candidate during login: ${
              (error as Error).message
            }`,
          );
        }
      }
      return false;
    }

    if (normalizedStoredHash.startsWith('$argon2')) {
      this.logger.error(
        'Unsupported password hash format detected ($argon2). Migrate affected users to bcrypt hashes.',
      );
      return false;
    }

    // Legacy compatibility: some old records may still store raw passwords.
    return this.constantTimeCompare(candidatePassword, normalizedStoredHash);
  }

  private async verifyAndUpgradeUserPassword(
    userId: string,
    candidatePassword: string,
    storedHash: string,
  ): Promise<boolean> {
    const normalizedStoredHash = storedHash?.trim() || '';
    const passwordMatches = await this.comparePasswordWithLegacySupport(
      candidatePassword,
      normalizedStoredHash,
    );
    if (!passwordMatches) {
      return false;
    }

    if (!this.isBcryptLikeHash(normalizedStoredHash)) {
      const upgradedHash = await bcrypt.hash(candidatePassword, 10);
      await this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash: upgradedHash },
      });
      this.logger.warn(
        `Upgraded legacy plaintext password storage to bcrypt for user ${userId}`,
      );
    }

    return true;
  }

  private async assertCurrentPasswordForTwoFactor(
    user: { passwordHash: string | null },
    currentPassword: string,
  ) {
    if (!currentPassword) {
      throw new BadRequestException(
        'Current password is required for this 2FA action.',
      );
    }
    if (!user.passwordHash) {
      throw new BadRequestException('User does not have a password set');
    }

    const isPasswordValid = await this.comparePasswordWithLegacySupport(
      currentPassword,
      user.passwordHash,
    );
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid current password');
    }
  }

  private async sendTwoFactorSecurityAlert(
    user: {
      id?: string;
      email?: string | null;
      name?: string | null;
      zoneId?: string | null;
      country?: string | null;
      region?: string | null;
    },
    action: 'enabled' | 'disabled',
  ) {
    if (!user.email) return;

    const at = new Date().toISOString();
    const subject =
      action === 'enabled'
        ? 'Two-Factor Authentication Enabled'
        : 'Two-Factor Authentication Disabled';
    const actionLabel = action === 'enabled' ? 'enabled' : 'disabled';

    const html = `
      <p>Hello ${user.name || 'there'},</p>
      <p>Two-factor authentication was <strong>${actionLabel}</strong> on your account.</p>
      <p>Time: ${at}</p>
      <p>If this was not you, reset your password immediately and contact support.</p>
    `;

    try {
      await this.mailService.sendMail(user.email, subject, html, {
        userId: user.id,
        zoneId: user.zoneId,
        country: user.country,
        region: user.region,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to send 2FA ${action} security alert`,
        String(error).replace(/[\n\r]/g, ''),
      );
    }
  }

  async generate2faSecret(userId: string, currentPassword: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        zoneId: true,
        country: true,
        region: true,
        passwordHash: true,
        twoFactorEnabled: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.twoFactorEnabled) {
      throw new BadRequestException(
        '2FA is already enabled. Disable it first before reconfiguring.',
      );
    }

    await this.assertCurrentPasswordForTwoFactor(user, currentPassword);

    const appName = this.config.get<string>('APP_NAME') || 'EVzone';
    const secretObj = speakeasy.generateSecret({ name: appName });
    const secret = secretObj.base32;
    const otpauthUrl = secretObj.otpauth_url || '';
    const encryptedSecret = this.encryptTwoFactorSecret(secret);

    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorSecret: encryptedSecret },
    });

    await this.recordAuditEvent({
      actor: userId,
      action: '2FA_SETUP_INITIATED',
      resource: 'User',
      resourceId: userId,
    });

    const qrCodeUrl = await qrcode.toDataURL(otpauthUrl);
    return { qrCodeUrl, secret };
  }

  async verify2faSetup(userId: string, token: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        zoneId: true,
        country: true,
        region: true,
        twoFactorSecret: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    if (!user.twoFactorSecret) {
      throw new BadRequestException('2FA secret not generated');
    }

    this.assertTwoFactorAttemptAllowed(userId, 'verify');

    const resolvedSecret = this.decryptTwoFactorSecret(user.twoFactorSecret);
    const isValid = speakeasy.totp.verify({
      secret: resolvedSecret,
      encoding: 'base32',
      token,
      window: 1,
    });
    if (!isValid) {
      this.registerTwoFactorFailure(userId, 'verify');
      await this.recordAuditEvent({
        actor: userId,
        action: '2FA_VERIFY_FAILED',
        resource: 'User',
        resourceId: userId,
        status: 'FAILED',
      });
      throw new BadRequestException('Invalid 2FA token');
    }

    this.clearTwoFactorFailures(userId, 'verify');

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: true,
        mfaRequired: true,
        twoFactorSecret: user.twoFactorSecret.startsWith(
          `${this.twoFactorSecretPrefix}:`,
        )
          ? user.twoFactorSecret
          : this.encryptTwoFactorSecret(resolvedSecret),
      },
    });

    await this.recordAuditEvent({
      actor: userId,
      action: '2FA_ENABLED',
      resource: 'User',
      resourceId: userId,
    });
    await this.sendTwoFactorSecurityAlert(user, 'enabled');

    return { success: true, message: '2FA enabled successfully' };
  }

  async disable2fa(userId: string, token: string, currentPassword: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        zoneId: true,
        country: true,
        region: true,
        passwordHash: true,
        twoFactorEnabled: true,
        twoFactorSecret: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    if (!user.twoFactorEnabled || !user.twoFactorSecret) {
      throw new BadRequestException('2FA is not enabled');
    }

    await this.assertCurrentPasswordForTwoFactor(user, currentPassword);
    this.assertTwoFactorAttemptAllowed(userId, 'disable');

    const resolvedSecret = this.decryptTwoFactorSecret(user.twoFactorSecret);
    const isValid = speakeasy.totp.verify({
      secret: resolvedSecret,
      encoding: 'base32',
      token,
      window: 1,
    });
    if (!isValid) {
      this.registerTwoFactorFailure(userId, 'disable');
      await this.recordAuditEvent({
        actor: userId,
        action: '2FA_DISABLE_FAILED',
        resource: 'User',
        resourceId: userId,
        status: 'FAILED',
      });
      throw new BadRequestException('Invalid 2FA token');
    }

    this.clearTwoFactorFailures(userId, 'disable');

    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: false, twoFactorSecret: null },
    });

    await this.recordAuditEvent({
      actor: userId,
      action: '2FA_DISABLED',
      resource: 'User',
      resourceId: userId,
    });
    await this.sendTwoFactorSecurityAlert(user, 'disabled');

    return { success: true, message: '2FA disabled successfully' };
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    confirmation?: MfaConfirmationInput,
  ): Promise<{ success: boolean; message: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (!user.passwordHash)
      throw new BadRequestException('User does not have a password set');

    const isPasswordValid = await this.comparePasswordWithLegacySupport(
      currentPassword,
      user.passwordHash,
    );
    if (!isPasswordValid)
      throw new UnauthorizedException('Invalid current password');

    await this.assertSensitiveActionMfa(
      {
        id: user.id,
        mfaRequired: Boolean(user.mfaRequired),
        twoFactorEnabled: Boolean(user.twoFactorEnabled),
        twoFactorSecret: user.twoFactorSecret,
      },
      'PASSWORD_CHANGE',
      confirmation,
      'Changing password requires recent MFA verification',
    );

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: hashedPassword, mustChangePassword: false },
    });
    await this.forceLogoutUser(userId);

    try {
      if (user.email) {
        await this.mailService.sendMail(
          user.email,
          'Your Password Has Been Changed',
          `<p>Hello ${user.name},</p><p>Your password was successfully changed. If you did not make this change, please contact support immediately.</p>`,
          {
            userId: user.id,
            zoneId: user.zoneId,
            country: user.country,
            region: user.region,
          },
        );
      }
    } catch (e) {
      this.logger.warn('Failed to send password change notification email', e);
    }

    return { success: true, message: 'Password changed successfully' };
  }
}

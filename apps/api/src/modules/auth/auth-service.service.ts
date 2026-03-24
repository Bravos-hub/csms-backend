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
  PayoutMethod,
  StationOwnerCapability,
  AttendantRoleMode,
  User,
  UserRole,
} from '@prisma/client';
import {
  LoginDto,
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
import { parsePaginationOptions } from '../../common/utils/pagination';
import {
  AuthAnomalyMonitorService,
  AuthMonitoringContext,
} from './auth-anomaly-monitor.service';

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
    mustChangePassword: true,
    lastStationAssignmentId: true,
    createdAt: true,
    updatedAt: true,
  } as const;
  private readonly membershipSummarySelect = {
    id: true,
    organizationId: true,
    role: true,
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
  private readonly twoFactorAttempts = new Map<
    string,
    { failures: number; lastFailedAt: number; lockedUntil: number }
  >();

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

  private async getTeamManagerScope(
    actorId: string,
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
        organizationId: true,
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

    const activeOrganizationId = actor.organizationId;
    if (!activeOrganizationId) {
      throw new UnauthorizedException(
        'Authenticated user is missing an active organization context',
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
    const startTime = Date.now();
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

      if (user.twoFactorEnabled) {
        if (!user.twoFactorSecret) {
          throw new BadRequestException(
            'Two-factor authentication is enabled but not configured. Disable and reconfigure 2FA.',
          );
        }

        const twoFactorToken = loginDto.twoFactorToken?.trim();
        if (!twoFactorToken) {
          await this.recordAuditEvent({
            actor: user.id,
            action: '2FA_LOGIN_CHALLENGE_REQUIRED',
            resource: 'User',
            resourceId: user.id,
            status: 'FAILED',
          });
          throw new BadRequestException(
            'Two-factor authentication code required',
          );
        }

        this.assertTwoFactorAttemptAllowed(user.id, 'login');
        const resolvedSecret = this.decryptTwoFactorSecret(
          user.twoFactorSecret,
        );
        const isTwoFactorTokenValid = speakeasy.totp.verify({
          secret: resolvedSecret,
          encoding: 'base32',
          token: twoFactorToken,
          window: 1,
        });

        if (!isTwoFactorTokenValid) {
          this.registerTwoFactorFailure(user.id, 'login');
          await this.recordAuditEvent({
            actor: user.id,
            action: '2FA_LOGIN_FAILED',
            resource: 'User',
            resourceId: user.id,
            status: 'FAILED',
          });
          throw new BadRequestException(
            'Invalid two-factor authentication code',
          );
        }

        this.clearTwoFactorFailures(user.id, 'login');
        await this.recordAuditEvent({
          actor: user.id,
          action: '2FA_LOGIN_VERIFIED',
          resource: 'User',
          resourceId: user.id,
        });
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
        `Login error for ${loginDto.email || loginDto.phone}: ${error.message}`,
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
          customRoleId: invitation.customRoleId,
          customRoleName: invitation.customRoleName,
          ownerCapability: invitation.ownerCapability,
          status: MembershipStatus.ACTIVE,
          invitedBy: invitation.invitedBy || undefined,
        },
        update: {
          role: invitation.role,
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
        {
          userId: result.user.id,
          zoneId: result.user.zoneId,
          country: result.user.country,
          region: result.user.region,
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
    const inviteRole = this.parseUserRole(inviteDto.role as string, 'invite');
    this.assertTeamManageableRole(inviteRole, 'invite');
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
          customRoleId: inviteDto.customRoleId || null,
          customRoleName: inviteDto.customRoleName || null,
          ownerCapability:
            inviteDto.ownerCapability as unknown as StationOwnerCapability,
          status: MembershipStatus.INVITED,
          invitedBy: inviter.id,
        },
        update: {
          role: inviteRole,
          customRoleId: inviteDto.customRoleId || null,
          customRoleName: inviteDto.customRoleName || null,
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

    try {
      await this.mailService.sendInvitationEmail(
        normalizedEmail,
        this.toRoleLabel(inviteRole),
        organization?.name || this.evzoneOrganizationName,
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
          {
            userId: user.id,
            zoneId: user.zoneId,
            country: user.country,
            region: user.region,
          },
        );
      } else {
        await this.notificationService.sendSms(
          identifier,
          `EvZone: Your verification code is ${code}`,
          {
            userId: user.id,
            zoneId: user.zoneId,
            country: user.country,
            region: user.region,
          },
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
    const { stationContexts, activeStationContext } =
      await this.resolveStationContexts(
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

    await this.syncLegacyOrganizationId(
      user.id,
      user.organizationId,
      activeOrganizationId,
    );
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
      stationContexts,
      activeStationContext,
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
        stationContexts: context.stationContexts,
        activeStationContext: context.activeStationContext,
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
          stationContexts: authUserContext.stationContexts,
          activeStationContext: authUserContext.activeStationContext,
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

  async findTeamMembers(actorId: string) {
    const scope = await this.getTeamManagerScope(actorId);

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

  async inviteTeamMember(inviteDto: TeamInviteUserDto, inviterId: string) {
    const scope = await this.getTeamManagerScope(inviterId);
    const inviteRole = this.parseUserRole(
      inviteDto.role as string,
      'team invite',
    );
    this.assertTeamManageableRole(inviteRole, 'team invite');

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
  ) {
    const scope = await this.getTeamManagerScope(actorId);
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
      updateData.role = parsedRole;
      membershipUpdateData.role = parsedRole;
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

  async getTeamAssignments(targetUserId: string, actorId: string) {
    const scope = await this.getTeamManagerScope(actorId);
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
  ) {
    const scope = await this.getTeamManagerScope(actorId);
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

    return this.getTeamAssignments(targetUserId, actorId);
  }

  async getStaffPayoutProfile(targetUserId: string, actorId: string) {
    const scope = await this.getTeamManagerScope(actorId);
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
  ) {
    const scope = await this.getTeamManagerScope(actorId);
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

  async getUserStationContexts(userId: string) {
    if (!userId) {
      throw new UnauthorizedException('Authenticated user context is required');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        organizationId: true,
        lastStationAssignmentId: true,
      },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    return this.resolveStationContexts(
      user.id,
      user.organizationId,
      user.lastStationAssignmentId,
    );
  }

  async switchUserStationContext(userId: string, assignmentId: string) {
    if (!userId) {
      throw new UnauthorizedException('Authenticated user context is required');
    }
    if (!assignmentId) {
      throw new BadRequestException('assignmentId is required');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        organizationId: true,
      },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const assignment = await this.prisma.stationTeamAssignment.findFirst({
      where: {
        id: assignmentId,
        userId,
        isActive: true,
        ...(user.organizationId
          ? {
              station: {
                orgId: user.organizationId,
              },
            }
          : {}),
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
      user.organizationId,
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
    const stationContextBundle = await this.resolveStationContexts(
      user.id,
      activeOrganizationId,
      user.lastStationAssignmentId,
    );
    const membershipRole = this.resolveEffectiveRole(
      user,
      user.memberships.map((membership) => ({
        organizationId: membership.organizationId,
        role: membership.role,
      })),
      activeOrganizationId,
    );
    const effectiveRole =
      stationContextBundle.activeStationContext?.role || membershipRole;

    return {
      ...user,
      role: effectiveRole,
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
      stationContexts: stationContextBundle.stationContexts,
      activeStationContext: stationContextBundle.activeStationContext,
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
    await this.prisma.user.update({
      where: { id: userId },
      data: { status: required ? 'MfaRequired' : 'Active' },
    });
  }

  // 2FA Methods

  private getTwoFactorAttemptKey(
    userId: string,
    action: 'verify' | 'disable' | 'login',
  ) {
    return `${userId}:${action}`;
  }

  private assertTwoFactorAttemptAllowed(
    userId: string,
    action: 'verify' | 'disable' | 'login',
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
    action: 'verify' | 'disable' | 'login',
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
    action: 'verify' | 'disable' | 'login',
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
  ) {
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

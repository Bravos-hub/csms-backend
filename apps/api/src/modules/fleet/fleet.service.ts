import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TenantContextService } from '@app/db';
import { resolveCanonicalRoleKey, type CanonicalRoleKey } from '@app/domain';
import { MembershipStatus, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import {
  AssignFleetDriverTokenDto,
  CreateFleetAccountDto,
  CreateFleetDriverDto,
  CreateFleetDriverGroupDto,
  FleetListQueryDto,
  RevokeFleetDriverTokenDto,
  UpdateFleetAccountDto,
  UpdateFleetDriverDto,
  UpdateFleetDriverGroupDto,
} from './dto/fleet.dto';

const READ_CANONICAL_ROLES = new Set<CanonicalRoleKey>([
  'PLATFORM_SUPER_ADMIN',
  'TENANT_ADMIN',
  'STATION_MANAGER',
  'OPERATIONS_OPERATOR',
  'FLEET_DISPATCHER',
  'FLEET_DRIVER',
]);

const WRITE_CANONICAL_ROLES = new Set<CanonicalRoleKey>([
  'PLATFORM_SUPER_ADMIN',
  'TENANT_ADMIN',
  'STATION_MANAGER',
  'OPERATIONS_OPERATOR',
  'FLEET_DISPATCHER',
]);

const PLATFORM_ADMIN_STORAGE_ROLES = new Set<UserRole>([
  UserRole.SUPER_ADMIN,
  UserRole.EVZONE_ADMIN,
]);

type FleetActorMode = 'read' | 'write';

@Injectable()
export class FleetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async getOverview(actorId: string): Promise<Record<string, unknown>> {
    const tenantId = this.resolveTenantId();
    await this.assertTenantAccess(actorId, tenantId, 'read');

    const [
      accountCount,
      driverGroupCount,
      driverCount,
      activeDriverCount,
      activeTokenCount,
      suspendedDriverCount,
      accounts,
      groups,
      drivers,
    ] = await Promise.all([
      this.prisma.fleetAccount.count({ where: { organizationId: tenantId } }),
      this.prisma.fleetDriverGroup.count({
        where: { organizationId: tenantId },
      }),
      this.prisma.fleetDriver.count({ where: { organizationId: tenantId } }),
      this.prisma.fleetDriver.count({
        where: { organizationId: tenantId, status: 'ACTIVE' },
      }),
      this.prisma.fleetDriverToken.count({
        where: { organizationId: tenantId, status: 'ACTIVE' },
      }),
      this.prisma.fleetDriver.count({
        where: { organizationId: tenantId, status: 'SUSPENDED' },
      }),
      this.prisma.fleetAccount.findMany({
        where: { organizationId: tenantId },
        include: { _count: { select: { driverGroups: true, drivers: true } } },
        orderBy: { updatedAt: 'desc' },
        take: 10,
      }),
      this.prisma.fleetDriverGroup.findMany({
        where: { organizationId: tenantId },
        include: {
          fleetAccount: { select: { id: true, name: true } },
          _count: { select: { drivers: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 10,
      }),
      this.prisma.fleetDriver.findMany({
        where: { organizationId: tenantId },
        include: {
          fleetAccount: { select: { id: true, name: true } },
          group: { select: { id: true, name: true } },
          tokens: { orderBy: { assignedAt: 'desc' } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 10,
      }),
    ]);

    return {
      stats: {
        accountCount,
        driverGroupCount,
        driverCount,
        activeDriverCount,
        activeTokenCount,
        suspendedDriverCount,
      },
      accounts,
      groups,
      drivers,
    };
  }

  async listAccounts(
    actorId: string,
    query: FleetListQueryDto,
  ): Promise<Record<string, unknown>[]> {
    const tenantId = this.resolveTenantId();
    await this.assertTenantAccess(actorId, tenantId, 'read');
    const search = this.optionalTrimmed(query.search);

    return this.prisma.fleetAccount.findMany({
      where: {
        organizationId: tenantId,
        ...(query.status ? { status: query.status.trim().toUpperCase() } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { code: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: { _count: { select: { driverGroups: true, drivers: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createAccount(
    actorId: string,
    dto: CreateFleetAccountDto,
  ): Promise<Record<string, unknown>> {
    const tenantId = this.resolveTenantId();
    await this.assertTenantAccess(actorId, tenantId, 'write');

    try {
      return await this.prisma.fleetAccount.create({
        data: {
          organizationId: tenantId,
          name: this.requiredTrimmed(dto.name, 'name'),
          code: this.optionalTrimmed(dto.code),
          status: this.normalizeStatus(dto.status),
          currency: this.normalizeCurrencyCode(dto.currency),
          monthlySpendLimit: this.normalizeNullableAmount(
            dto.monthlySpendLimit,
          ),
          dailySpendLimit: this.normalizeNullableAmount(dto.dailySpendLimit),
          metadata: this.normalizeMetadata(dto.metadata),
          createdBy: actorId,
          updatedBy: actorId,
        },
        include: { _count: { select: { driverGroups: true, drivers: true } } },
      });
    } catch (error) {
      this.handleKnownPrismaError(error, 'Fleet account already exists');
      throw error;
    }
  }

  async updateAccount(
    actorId: string,
    accountId: string,
    dto: UpdateFleetAccountDto,
  ): Promise<Record<string, unknown>> {
    const tenantId = this.resolveTenantId();
    await this.assertTenantAccess(actorId, tenantId, 'write');
    await this.assertAccountInTenant(accountId, tenantId);

    try {
      return await this.prisma.fleetAccount.update({
        where: { id: accountId },
        data: {
          ...(dto.name !== undefined
            ? { name: this.requiredTrimmed(dto.name, 'name') }
            : {}),
          ...(dto.code !== undefined
            ? { code: this.optionalTrimmed(dto.code) }
            : {}),
          ...(dto.status !== undefined
            ? { status: this.normalizeStatus(dto.status) }
            : {}),
          ...(dto.currency !== undefined
            ? { currency: this.normalizeCurrencyCode(dto.currency) }
            : {}),
          ...(dto.monthlySpendLimit !== undefined
            ? {
                monthlySpendLimit: this.normalizeNullableAmount(
                  dto.monthlySpendLimit,
                ),
              }
            : {}),
          ...(dto.dailySpendLimit !== undefined
            ? {
                dailySpendLimit: this.normalizeNullableAmount(
                  dto.dailySpendLimit,
                ),
              }
            : {}),
          ...(dto.metadata !== undefined
            ? { metadata: this.normalizeMetadata(dto.metadata) }
            : {}),
          updatedBy: actorId,
        },
        include: { _count: { select: { driverGroups: true, drivers: true } } },
      });
    } catch (error) {
      this.handleKnownPrismaError(error, 'Fleet account already exists');
      throw error;
    }
  }

  async listDriverGroups(
    actorId: string,
    query: FleetListQueryDto,
  ): Promise<Record<string, unknown>[]> {
    const tenantId = this.resolveTenantId();
    await this.assertTenantAccess(actorId, tenantId, 'read');
    const search = this.optionalTrimmed(query.search);

    return this.prisma.fleetDriverGroup.findMany({
      where: {
        organizationId: tenantId,
        ...(query.fleetAccountId
          ? { fleetAccountId: query.fleetAccountId.trim() }
          : {}),
        ...(query.status ? { status: query.status.trim().toUpperCase() } : {}),
        ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
      },
      include: {
        fleetAccount: { select: { id: true, name: true } },
        _count: { select: { drivers: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createDriverGroup(
    actorId: string,
    dto: CreateFleetDriverGroupDto,
  ): Promise<Record<string, unknown>> {
    const tenantId = this.resolveTenantId();
    await this.assertTenantAccess(actorId, tenantId, 'write');
    await this.assertAccountInTenant(dto.fleetAccountId, tenantId);
    await this.assertPolicyScopes(tenantId, dto.tariffIds, dto.locationIds);

    try {
      return await this.prisma.fleetDriverGroup.create({
        data: {
          organizationId: tenantId,
          fleetAccountId: dto.fleetAccountId.trim(),
          name: this.requiredTrimmed(dto.name, 'name'),
          description: this.optionalTrimmed(dto.description),
          status: this.normalizeStatus(dto.status),
          tariffIds: this.normalizeStringArray(dto.tariffIds),
          locationIds: this.normalizeStringArray(dto.locationIds),
          monthlySpendLimit: this.normalizeNullableAmount(
            dto.monthlySpendLimit,
          ),
          dailySpendLimit: this.normalizeNullableAmount(dto.dailySpendLimit),
          metadata: this.normalizeMetadata(dto.metadata),
          createdBy: actorId,
          updatedBy: actorId,
        },
        include: {
          fleetAccount: { select: { id: true, name: true } },
          _count: { select: { drivers: true } },
        },
      });
    } catch (error) {
      this.handleKnownPrismaError(error, 'Fleet driver group already exists');
      throw error;
    }
  }

  async updateDriverGroup(
    actorId: string,
    groupId: string,
    dto: UpdateFleetDriverGroupDto,
  ): Promise<Record<string, unknown>> {
    const tenantId = this.resolveTenantId();
    await this.assertTenantAccess(actorId, tenantId, 'write');

    const group = await this.prisma.fleetDriverGroup.findUnique({
      where: { id: groupId },
      select: { organizationId: true },
    });
    if (!group || group.organizationId !== tenantId) {
      throw new NotFoundException('Fleet driver group not found');
    }
    await this.assertPolicyScopes(tenantId, dto.tariffIds, dto.locationIds);

    try {
      return await this.prisma.fleetDriverGroup.update({
        where: { id: groupId },
        data: {
          ...(dto.name !== undefined
            ? { name: this.requiredTrimmed(dto.name, 'name') }
            : {}),
          ...(dto.description !== undefined
            ? { description: this.optionalTrimmed(dto.description) }
            : {}),
          ...(dto.status !== undefined
            ? { status: this.normalizeStatus(dto.status) }
            : {}),
          ...(dto.tariffIds !== undefined
            ? { tariffIds: this.normalizeStringArray(dto.tariffIds) }
            : {}),
          ...(dto.locationIds !== undefined
            ? { locationIds: this.normalizeStringArray(dto.locationIds) }
            : {}),
          ...(dto.monthlySpendLimit !== undefined
            ? {
                monthlySpendLimit: this.normalizeNullableAmount(
                  dto.monthlySpendLimit,
                ),
              }
            : {}),
          ...(dto.dailySpendLimit !== undefined
            ? {
                dailySpendLimit: this.normalizeNullableAmount(
                  dto.dailySpendLimit,
                ),
              }
            : {}),
          ...(dto.metadata !== undefined
            ? { metadata: this.normalizeMetadata(dto.metadata) }
            : {}),
          updatedBy: actorId,
        },
        include: {
          fleetAccount: { select: { id: true, name: true } },
          _count: { select: { drivers: true } },
        },
      });
    } catch (error) {
      this.handleKnownPrismaError(error, 'Fleet driver group already exists');
      throw error;
    }
  }

  async listDrivers(
    actorId: string,
    query: FleetListQueryDto,
  ): Promise<Record<string, unknown>[]> {
    const tenantId = this.resolveTenantId();
    await this.assertTenantAccess(actorId, tenantId, 'read');
    const search = this.optionalTrimmed(query.search);

    return this.prisma.fleetDriver.findMany({
      where: {
        organizationId: tenantId,
        ...(query.fleetAccountId
          ? { fleetAccountId: query.fleetAccountId.trim() }
          : {}),
        ...(query.groupId ? { groupId: query.groupId.trim() } : {}),
        ...(query.status ? { status: query.status.trim().toUpperCase() } : {}),
        ...(search
          ? {
              OR: [
                { displayName: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
                { externalRef: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: {
        fleetAccount: { select: { id: true, name: true } },
        group: { select: { id: true, name: true } },
        tokens: { orderBy: { assignedAt: 'desc' } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createDriver(
    actorId: string,
    dto: CreateFleetDriverDto,
  ): Promise<Record<string, unknown>> {
    const tenantId = this.resolveTenantId();
    await this.assertTenantAccess(actorId, tenantId, 'write');
    await this.assertAccountInTenant(dto.fleetAccountId, tenantId);

    if (dto.groupId) {
      await this.assertGroupInTenant(dto.groupId, tenantId, dto.fleetAccountId);
    }
    if (dto.userId) {
      await this.assertUserInTenant(dto.userId, tenantId);
    }

    return this.prisma.fleetDriver.create({
      data: {
        organizationId: tenantId,
        fleetAccountId: dto.fleetAccountId.trim(),
        groupId: this.optionalTrimmed(dto.groupId),
        userId: this.optionalTrimmed(dto.userId),
        displayName: this.requiredTrimmed(dto.displayName, 'displayName'),
        email: this.normalizeEmail(dto.email),
        phone: this.optionalTrimmed(dto.phone),
        externalRef: this.optionalTrimmed(dto.externalRef),
        status: this.normalizeStatus(dto.status),
        monthlySpendLimit: this.normalizeNullableAmount(dto.monthlySpendLimit),
        dailySpendLimit: this.normalizeNullableAmount(dto.dailySpendLimit),
        metadata: this.normalizeMetadata(dto.metadata),
        createdBy: actorId,
        updatedBy: actorId,
      },
      include: {
        fleetAccount: { select: { id: true, name: true } },
        group: { select: { id: true, name: true } },
        tokens: { orderBy: { assignedAt: 'desc' } },
      },
    });
  }

  async updateDriver(
    actorId: string,
    driverId: string,
    dto: UpdateFleetDriverDto,
  ): Promise<Record<string, unknown>> {
    const tenantId = this.resolveTenantId();
    await this.assertTenantAccess(actorId, tenantId, 'write');

    const existing = await this.prisma.fleetDriver.findUnique({
      where: { id: driverId },
      select: {
        organizationId: true,
        fleetAccountId: true,
      },
    });
    if (!existing || existing.organizationId !== tenantId) {
      throw new NotFoundException('Fleet driver not found');
    }

    if (dto.groupId) {
      await this.assertGroupInTenant(
        dto.groupId,
        tenantId,
        existing.fleetAccountId,
      );
    }
    if (dto.userId) {
      await this.assertUserInTenant(dto.userId, tenantId);
    }

    return this.prisma.fleetDriver.update({
      where: { id: driverId },
      data: {
        ...(dto.groupId !== undefined
          ? { groupId: this.optionalTrimmed(dto.groupId) }
          : {}),
        ...(dto.userId !== undefined
          ? { userId: this.optionalTrimmed(dto.userId) }
          : {}),
        ...(dto.displayName !== undefined
          ? {
              displayName: this.requiredTrimmed(dto.displayName, 'displayName'),
            }
          : {}),
        ...(dto.email !== undefined
          ? { email: this.normalizeEmail(dto.email) }
          : {}),
        ...(dto.phone !== undefined
          ? { phone: this.optionalTrimmed(dto.phone) }
          : {}),
        ...(dto.externalRef !== undefined
          ? { externalRef: this.optionalTrimmed(dto.externalRef) }
          : {}),
        ...(dto.status !== undefined
          ? { status: this.normalizeStatus(dto.status) }
          : {}),
        ...(dto.monthlySpendLimit !== undefined
          ? {
              monthlySpendLimit: this.normalizeNullableAmount(
                dto.monthlySpendLimit,
              ),
            }
          : {}),
        ...(dto.dailySpendLimit !== undefined
          ? {
              dailySpendLimit: this.normalizeNullableAmount(
                dto.dailySpendLimit,
              ),
            }
          : {}),
        ...(dto.metadata !== undefined
          ? { metadata: this.normalizeMetadata(dto.metadata) }
          : {}),
        updatedBy: actorId,
      },
      include: {
        fleetAccount: { select: { id: true, name: true } },
        group: { select: { id: true, name: true } },
        tokens: { orderBy: { assignedAt: 'desc' } },
      },
    });
  }

  async assignDriverToken(
    actorId: string,
    driverId: string,
    dto: AssignFleetDriverTokenDto,
  ): Promise<Record<string, unknown>> {
    const tenantId = this.resolveTenantId();
    await this.assertTenantAccess(actorId, tenantId, 'write');
    await this.assertDriverInTenant(driverId, tenantId);

    const tokenUid = this.requiredTrimmed(dto.tokenUid, 'tokenUid');
    const tokenType = this.normalizeTokenType(dto.tokenType);

    const existing = await this.prisma.fleetDriverToken.findUnique({
      where: {
        organizationId_tokenUid_tokenType: {
          organizationId: tenantId,
          tokenUid,
          tokenType,
        },
      },
      select: { id: true, driverId: true },
    });

    if (existing && existing.driverId !== driverId) {
      throw new BadRequestException(
        'Token is already assigned to another fleet driver',
      );
    }

    if (existing) {
      await this.prisma.fleetDriverToken.update({
        where: { id: existing.id },
        data: {
          status: 'ACTIVE',
          revokedAt: null,
          metadata: this.normalizeMetadata(dto.metadata),
        },
      });
    } else {
      await this.prisma.fleetDriverToken.create({
        data: {
          organizationId: tenantId,
          driverId,
          tokenUid,
          tokenType,
          status: 'ACTIVE',
          metadata: this.normalizeMetadata(dto.metadata),
          createdBy: actorId,
        },
      });
    }

    const driver = await this.prisma.fleetDriver.findUnique({
      where: { id: driverId },
      include: {
        fleetAccount: { select: { id: true, name: true } },
        group: { select: { id: true, name: true } },
        tokens: { orderBy: { assignedAt: 'desc' } },
      },
    });
    if (!driver) {
      throw new NotFoundException('Fleet driver not found');
    }
    return driver;
  }

  async revokeDriverToken(
    actorId: string,
    driverId: string,
    tokenId: string,
    dto: RevokeFleetDriverTokenDto,
  ): Promise<Record<string, unknown>> {
    const tenantId = this.resolveTenantId();
    await this.assertTenantAccess(actorId, tenantId, 'write');
    await this.assertDriverInTenant(driverId, tenantId);

    const token = await this.prisma.fleetDriverToken.findUnique({
      where: { id: tokenId },
      select: {
        id: true,
        organizationId: true,
        driverId: true,
        metadata: true,
      },
    });
    if (
      !token ||
      token.organizationId !== tenantId ||
      token.driverId !== driverId
    ) {
      throw new NotFoundException('Fleet driver token not found');
    }

    await this.prisma.fleetDriverToken.update({
      where: { id: tokenId },
      data: {
        status: 'REVOKED',
        revokedAt: new Date(),
        metadata: {
          ...this.ensureRecord(token.metadata),
          revokedBy: actorId,
          revokedReason: this.optionalTrimmed(dto.reason),
        } as Prisma.InputJsonValue,
      },
    });

    const driver = await this.prisma.fleetDriver.findUnique({
      where: { id: driverId },
      include: {
        fleetAccount: { select: { id: true, name: true } },
        group: { select: { id: true, name: true } },
        tokens: { orderBy: { assignedAt: 'desc' } },
      },
    });
    if (!driver) {
      throw new NotFoundException('Fleet driver not found');
    }
    return driver;
  }

  private async assertPolicyScopes(
    tenantId: string,
    tariffIds?: string[],
    locationIds?: string[],
  ): Promise<void> {
    const normalizedTariffIds = this.normalizeStringArray(tariffIds);
    if (normalizedTariffIds.length > 0) {
      const rows = await this.prisma.tariffCalendar.findMany({
        where: { tenantId, id: { in: normalizedTariffIds } },
        select: { id: true },
      });
      const existing = new Set(rows.map((row) => row.id));
      const missing = normalizedTariffIds.filter((id) => !existing.has(id));
      if (missing.length > 0) {
        throw new BadRequestException(
          `Unknown tariff ids for active tenant: ${missing.join(', ')}`,
        );
      }
    }

    const normalizedLocationIds = this.normalizeStringArray(locationIds);
    if (normalizedLocationIds.length > 0) {
      const rows = await this.prisma.station.findMany({
        where: { orgId: tenantId, id: { in: normalizedLocationIds } },
        select: { id: true },
      });
      const existing = new Set(rows.map((row) => row.id));
      const missing = normalizedLocationIds.filter((id) => !existing.has(id));
      if (missing.length > 0) {
        throw new BadRequestException(
          `Unknown location ids for active tenant: ${missing.join(', ')}`,
        );
      }
    }
  }

  private resolveTenantId(): string {
    const context = this.tenantContext.get();
    const tenantId =
      context?.effectiveOrganizationId || context?.authenticatedOrganizationId;
    if (!tenantId) {
      throw new BadRequestException(
        'Active tenant context is required for fleet operations',
      );
    }
    return tenantId;
  }

  private requiredTrimmed(value: string, field: string): string {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      throw new BadRequestException(`${field} is required`);
    }
    return trimmed;
  }

  private optionalTrimmed(value?: string): string | null {
    if (value === undefined) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private normalizeEmail(value?: string): string | null {
    const normalized = this.optionalTrimmed(value);
    return normalized ? normalized.toLowerCase() : null;
  }

  private normalizeStatus(value?: string): string {
    const normalized = value?.trim().toUpperCase();
    if (!normalized) return 'ACTIVE';
    if (
      normalized !== 'ACTIVE' &&
      normalized !== 'INACTIVE' &&
      normalized !== 'SUSPENDED'
    ) {
      throw new BadRequestException(
        `Invalid status "${value}". Expected ACTIVE, INACTIVE, or SUSPENDED.`,
      );
    }
    return normalized;
  }

  private normalizeTokenType(value?: string): string {
    const normalized = value?.trim().toUpperCase();
    if (!normalized) return 'RFID';
    if (normalized.length > 40) {
      throw new BadRequestException('tokenType is too long');
    }
    return normalized;
  }

  private normalizeCurrencyCode(value?: string): string {
    const normalized = value?.trim().toUpperCase() || 'UGX';
    if (normalized.length < 3 || normalized.length > 8) {
      throw new BadRequestException('currency must be 3-8 characters');
    }
    return normalized;
  }

  private normalizeNullableAmount(value?: number): number | null {
    if (value === undefined || value === null) return null;
    if (!Number.isFinite(value)) {
      throw new BadRequestException('Amount values must be finite numbers');
    }
    if (value < 0) {
      throw new BadRequestException('Amount values cannot be negative');
    }
    return Number(value);
  }

  private normalizeStringArray(values?: string[]): string[] {
    if (!Array.isArray(values) || values.length === 0) return [];
    return Array.from(
      new Set(
        values.map((value) => value.trim()).filter((value) => value.length > 0),
      ),
    );
  }

  private normalizeMetadata(
    metadata?: Record<string, unknown>,
  ): Prisma.InputJsonValue | undefined {
    if (!metadata) return undefined;
    return metadata as Prisma.InputJsonValue;
  }

  private ensureRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }

  private async assertAccountInTenant(
    accountId: string,
    tenantId: string,
  ): Promise<void> {
    const account = await this.prisma.fleetAccount.findUnique({
      where: { id: accountId.trim() },
      select: { organizationId: true },
    });
    if (!account || account.organizationId !== tenantId) {
      throw new NotFoundException('Fleet account not found');
    }
  }

  private async assertGroupInTenant(
    groupId: string,
    tenantId: string,
    fleetAccountId: string,
  ): Promise<void> {
    const group = await this.prisma.fleetDriverGroup.findUnique({
      where: { id: groupId.trim() },
      select: { organizationId: true, fleetAccountId: true },
    });
    if (
      !group ||
      group.organizationId !== tenantId ||
      group.fleetAccountId !== fleetAccountId.trim()
    ) {
      throw new NotFoundException(
        'Fleet driver group not found for selected account',
      );
    }
  }

  private async assertDriverInTenant(
    driverId: string,
    tenantId: string,
  ): Promise<void> {
    const driver = await this.prisma.fleetDriver.findUnique({
      where: { id: driverId.trim() },
      select: { organizationId: true },
    });
    if (!driver || driver.organizationId !== tenantId) {
      throw new NotFoundException('Fleet driver not found');
    }
  }

  private async assertUserInTenant(
    userId: string,
    tenantId: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId.trim() },
      select: { organizationId: true },
    });
    if (!user) {
      throw new NotFoundException('Linked user does not exist');
    }
    if (user.organizationId && user.organizationId !== tenantId) {
      throw new ForbiddenException(
        'Linked user is outside the active tenant scope',
      );
    }
  }

  private async assertTenantAccess(
    actorId: string,
    tenantId: string,
    mode: FleetActorMode,
  ): Promise<void> {
    const normalizedActorId = this.requiredTrimmed(actorId, 'actorId');
    const controlPlane = this.prisma.getControlPlaneClient();

    const [user, membership] = await Promise.all([
      controlPlane.user.findUnique({
        where: { id: normalizedActorId },
        select: { role: true },
      }),
      controlPlane.organizationMembership.findUnique({
        where: {
          userId_organizationId: {
            userId: normalizedActorId,
            organizationId: tenantId,
          },
        },
        select: {
          role: true,
          canonicalRoleKey: true,
          status: true,
        },
      }),
    ]);

    if (!user) {
      throw new ForbiddenException('Authenticated user is not recognized');
    }

    const isPlatformAdmin = PLATFORM_ADMIN_STORAGE_ROLES.has(user.role);
    const isActiveMember = membership?.status === MembershipStatus.ACTIVE;
    if (!isPlatformAdmin && !isActiveMember) {
      throw new ForbiddenException(
        'User must be an active tenant member for fleet operations',
      );
    }

    const allowedRoles =
      mode === 'write' ? WRITE_CANONICAL_ROLES : READ_CANONICAL_ROLES;
    const effectiveRole =
      membership?.canonicalRoleKey ||
      resolveCanonicalRoleKey(membership?.role || user.role);

    if (!isPlatformAdmin && effectiveRole && !allowedRoles.has(effectiveRole)) {
      throw new ForbiddenException(
        `User role ${effectiveRole} cannot ${mode} fleet resources`,
      );
    }
  }

  private handleKnownPrismaError(error: unknown, message: string): void {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new BadRequestException(message);
    }
  }
}

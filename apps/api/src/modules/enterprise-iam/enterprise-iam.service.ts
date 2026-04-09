import { createHash } from 'crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TenantContextService } from '@app/db';
import { MembershipStatus, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import {
  CreateEnterpriseIdentityProviderDto,
  CreateEnterpriseSyncImportJobDto,
  ListEnterpriseProvidersQueryDto,
  ListEnterpriseSyncJobsQueryDto,
  UpdateEnterpriseIdentityProviderDto,
  UpdateEnterpriseRoleMappingsDto,
} from './dto/enterprise-iam.dto';

const PLATFORM_ADMIN_ROLES = new Set<UserRole>([
  UserRole.SUPER_ADMIN,
  UserRole.EVZONE_ADMIN,
]);

const PROVIDER_PROTOCOLS = new Set(['OIDC', 'SAML']);
const PROVIDER_STATUS = new Set(['ACTIVE', 'DISABLED', 'DRAFT']);
const PROVIDER_SYNC_MODE = new Set([
  'MANUAL_IMPORT',
  'FILE_IMPORT',
  'SCIM_PUSH',
]);
const IMPORT_MODE = new Set(['DRY_RUN', 'REVIEW_REQUIRED', 'APPLY']);

@Injectable()
export class EnterpriseIamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async getOverview(actorId: string): Promise<Record<string, unknown>> {
    const tenantId = this.resolveTenantId();
    await this.assertTenantActor(actorId, tenantId);

    const [
      providerCount,
      activeProviderCount,
      syncJobCount,
      providers,
      recentJobs,
    ] = await Promise.all([
      this.prisma.enterpriseIdentityProvider.count({
        where: { organizationId: tenantId },
      }),
      this.prisma.enterpriseIdentityProvider.count({
        where: { organizationId: tenantId, status: 'ACTIVE' },
      }),
      this.prisma.enterpriseIdentitySyncJob.count({
        where: { organizationId: tenantId },
      }),
      this.prisma.enterpriseIdentityProvider.findMany({
        where: { organizationId: tenantId },
        orderBy: [{ updatedAt: 'desc' }],
        include: {
          syncJobs: {
            orderBy: [{ createdAt: 'desc' }],
            take: 3,
          },
        },
        take: 50,
      }),
      this.prisma.enterpriseIdentitySyncJob.findMany({
        where: { organizationId: tenantId },
        include: {
          provider: {
            select: {
              id: true,
              name: true,
              protocol: true,
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }],
        take: 25,
      }),
    ]);

    const mappingCoverageCount = providers.filter((provider) => {
      const roleMappings = this.normalizeRoleMappings(provider.roleMappings);
      return Object.keys(roleMappings).length > 0;
    }).length;

    return {
      metrics: {
        providerCount,
        activeProviderCount,
        syncJobCount,
        mappingCoverageCount,
      },
      providers,
      recentJobs,
      note: 'Enterprise IAM import jobs use a controlled review-first workflow.',
    };
  }

  async listProviders(
    actorId: string,
    query: ListEnterpriseProvidersQueryDto,
  ): Promise<Record<string, unknown>[]> {
    const tenantId = this.resolveTenantId();
    await this.assertTenantActor(actorId, tenantId);

    const protocol = this.normalizeOptionalStatus(
      query.protocol,
      PROVIDER_PROTOCOLS,
    );
    const status = this.normalizeOptionalStatus(query.status, PROVIDER_STATUS);

    return this.prisma.enterpriseIdentityProvider.findMany({
      where: {
        organizationId: tenantId,
        ...(protocol ? { protocol } : {}),
        ...(status ? { status } : {}),
      },
      include: {
        syncJobs: {
          orderBy: [{ createdAt: 'desc' }],
          take: 10,
        },
      },
      orderBy: [{ updatedAt: 'desc' }],
    });
  }

  async createProvider(
    actorId: string,
    dto: CreateEnterpriseIdentityProviderDto,
  ): Promise<Record<string, unknown>> {
    const tenantId = this.resolveTenantId();
    await this.assertTenantActor(actorId, tenantId);

    try {
      return await this.prisma.enterpriseIdentityProvider.create({
        data: {
          organizationId: tenantId,
          name: this.requiredTrimmed(dto.name, 'name'),
          protocol:
            this.normalizeOptionalStatus(dto.protocol, PROVIDER_PROTOCOLS) ||
            'OIDC',
          status:
            this.normalizeOptionalStatus(dto.status, PROVIDER_STATUS) ||
            'ACTIVE',
          issuerUrl: this.optionalTrimmed(dto.issuerUrl),
          authorizationUrl: this.optionalTrimmed(dto.authorizationUrl),
          tokenUrl: this.optionalTrimmed(dto.tokenUrl),
          userInfoUrl: this.optionalTrimmed(dto.userInfoUrl),
          jwksUrl: this.optionalTrimmed(dto.jwksUrl),
          samlMetadataUrl: this.optionalTrimmed(dto.samlMetadataUrl),
          samlEntityId: this.optionalTrimmed(dto.samlEntityId),
          samlAcsUrl: this.optionalTrimmed(dto.samlAcsUrl),
          clientId: this.optionalTrimmed(dto.clientId),
          clientSecretRef: this.optionalTrimmed(dto.clientSecretRef),
          syncMode:
            this.normalizeOptionalStatus(dto.syncMode, PROVIDER_SYNC_MODE) ||
            'MANUAL_IMPORT',
          roleMappings: this.normalizeRoleMappings(dto.roleMappings),
          metadata: this.normalizeMetadata(dto.metadata),
          createdBy: actorId,
          updatedBy: actorId,
        },
      });
    } catch (error) {
      this.handleKnownPrismaError(
        error,
        'Enterprise identity provider name must be unique per tenant',
      );
      throw error;
    }
  }

  async updateProvider(
    actorId: string,
    providerId: string,
    dto: UpdateEnterpriseIdentityProviderDto,
  ): Promise<Record<string, unknown>> {
    const tenantId = this.resolveTenantId();
    await this.assertTenantActor(actorId, tenantId);
    await this.assertProviderInTenant(providerId, tenantId);

    return this.prisma.enterpriseIdentityProvider.update({
      where: { id: providerId },
      data: {
        ...(dto.status !== undefined
          ? {
              status:
                this.normalizeOptionalStatus(dto.status, PROVIDER_STATUS) ||
                'ACTIVE',
            }
          : {}),
        ...(dto.issuerUrl !== undefined
          ? { issuerUrl: this.optionalTrimmed(dto.issuerUrl) }
          : {}),
        ...(dto.authorizationUrl !== undefined
          ? { authorizationUrl: this.optionalTrimmed(dto.authorizationUrl) }
          : {}),
        ...(dto.tokenUrl !== undefined
          ? { tokenUrl: this.optionalTrimmed(dto.tokenUrl) }
          : {}),
        ...(dto.userInfoUrl !== undefined
          ? { userInfoUrl: this.optionalTrimmed(dto.userInfoUrl) }
          : {}),
        ...(dto.jwksUrl !== undefined
          ? { jwksUrl: this.optionalTrimmed(dto.jwksUrl) }
          : {}),
        ...(dto.samlMetadataUrl !== undefined
          ? { samlMetadataUrl: this.optionalTrimmed(dto.samlMetadataUrl) }
          : {}),
        ...(dto.samlEntityId !== undefined
          ? { samlEntityId: this.optionalTrimmed(dto.samlEntityId) }
          : {}),
        ...(dto.samlAcsUrl !== undefined
          ? { samlAcsUrl: this.optionalTrimmed(dto.samlAcsUrl) }
          : {}),
        ...(dto.clientId !== undefined
          ? { clientId: this.optionalTrimmed(dto.clientId) }
          : {}),
        ...(dto.clientSecretRef !== undefined
          ? { clientSecretRef: this.optionalTrimmed(dto.clientSecretRef) }
          : {}),
        ...(dto.syncMode !== undefined
          ? {
              syncMode:
                this.normalizeOptionalStatus(
                  dto.syncMode,
                  PROVIDER_SYNC_MODE,
                ) || 'MANUAL_IMPORT',
            }
          : {}),
        ...(dto.roleMappings !== undefined
          ? { roleMappings: this.normalizeRoleMappings(dto.roleMappings) }
          : {}),
        ...(dto.metadata !== undefined
          ? { metadata: this.normalizeMetadata(dto.metadata) }
          : {}),
        updatedBy: actorId,
      },
    });
  }

  async updateRoleMappings(
    actorId: string,
    providerId: string,
    dto: UpdateEnterpriseRoleMappingsDto,
  ): Promise<Record<string, unknown>> {
    const tenantId = this.resolveTenantId();
    await this.assertTenantActor(actorId, tenantId);
    await this.assertProviderInTenant(providerId, tenantId);

    return this.prisma.enterpriseIdentityProvider.update({
      where: { id: providerId },
      data: {
        roleMappings: this.normalizeRoleMappings(dto.roleMappings),
        updatedBy: actorId,
      },
    });
  }

  async listSyncJobs(
    actorId: string,
    query: ListEnterpriseSyncJobsQueryDto,
  ): Promise<Record<string, unknown>[]> {
    const tenantId = this.resolveTenantId();
    await this.assertTenantActor(actorId, tenantId);

    if (query.providerId) {
      await this.assertProviderInTenant(query.providerId, tenantId);
    }

    const status = this.optionalTrimmed(query.status);

    return this.prisma.enterpriseIdentitySyncJob.findMany({
      where: {
        organizationId: tenantId,
        ...(query.providerId ? { providerId: query.providerId } : {}),
        ...(status ? { status: status.toUpperCase() } : {}),
      },
      include: {
        provider: {
          select: {
            id: true,
            name: true,
            protocol: true,
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 100,
    });
  }

  async createSyncImportJob(
    actorId: string,
    providerId: string,
    dto: CreateEnterpriseSyncImportJobDto,
  ): Promise<Record<string, unknown>> {
    const tenantId = this.resolveTenantId();
    await this.assertTenantActor(actorId, tenantId);

    const provider = await this.assertProviderInTenant(providerId, tenantId);
    const includeGroupsOnly = Boolean(dto.includeGroupsOnly);
    const requestedMode =
      this.normalizeOptionalStatus(dto.mode, IMPORT_MODE) || 'DRY_RUN';

    const normalizedGroups = this.normalizeGroups(dto.groups || []);
    const normalizedUsers = includeGroupsOnly
      ? []
      : this.normalizeUsers(dto.users || []);
    const roleMappings = this.normalizeRoleMappings(provider.roleMappings);
    const groupRoleMap = new Map<string, string>();

    for (const group of normalizedGroups) {
      const mappingFromProvider = roleMappings[group.name]?.[0] || null;
      const mappedRole =
        group.mappedRoleKey ||
        (mappingFromProvider ? mappingFromProvider.trim() : null);
      if (mappedRole) {
        groupRoleMap.set(group.name, mappedRole);
      }
    }

    let usersMappedToRole = 0;
    let usersWithoutRole = 0;
    const usersPreview = normalizedUsers.map((user) => {
      const explicitRole = user.mappedRoleKey;
      const groupRole = (user.groups || [])
        .map((groupName) => groupRoleMap.get(groupName) || null)
        .find((value) => value !== null);
      const effectiveRole = explicitRole || groupRole || null;

      if (effectiveRole) {
        usersMappedToRole += 1;
      } else {
        usersWithoutRole += 1;
      }

      return {
        email: user.email,
        displayName: user.displayName,
        externalId: user.externalId,
        groups: user.groups,
        effectiveRole,
      };
    });

    const duplicateGroupCount =
      (dto.groups?.length || 0) - normalizedGroups.length;
    const duplicateUserCount =
      (includeGroupsOnly ? 0 : dto.users?.length || 0) - normalizedUsers.length;
    const rejectedRecords = Math.max(
      0,
      duplicateGroupCount + duplicateUserCount,
    );
    const status =
      requestedMode === 'APPLY' ? 'REVIEW_REQUIRED' : requestedMode;
    const startedAt = new Date();
    const completedAt = new Date();
    const payloadForDigest = {
      mode: requestedMode,
      includeGroupsOnly,
      groups: normalizedGroups,
      users: usersPreview,
    };
    const payloadDigest = createHash('sha256')
      .update(JSON.stringify(payloadForDigest))
      .digest('hex');

    return this.prisma.enterpriseIdentitySyncJob.create({
      data: {
        providerId: provider.id,
        organizationId: tenantId,
        triggerType: 'MANUAL_IMPORT',
        status,
        importedUsers: normalizedUsers.length,
        importedGroups: normalizedGroups.length,
        rejectedRecords,
        payloadDigest,
        summary: {
          requestedMode,
          appliedMode: status,
          autoProvisioningPerformed: false,
          usersMappedToRole,
          usersWithoutRole,
          duplicateUserCount,
          duplicateGroupCount,
          includeGroupsOnly,
          preview: {
            groups: normalizedGroups.slice(0, 50),
            users: usersPreview.slice(0, 250),
          },
        } as Prisma.InputJsonValue,
        startedAt,
        completedAt,
        createdBy: actorId,
      },
      include: {
        provider: {
          select: {
            id: true,
            name: true,
            protocol: true,
          },
        },
      },
    });
  }

  private normalizeGroups(
    groups: Array<{
      name: string;
      externalId?: string;
      mappedRoleKey?: string;
    }>,
  ): Array<{
    name: string;
    externalId: string | null;
    mappedRoleKey: string | null;
  }> {
    const seen = new Set<string>();
    const normalized: Array<{
      name: string;
      externalId: string | null;
      mappedRoleKey: string | null;
    }> = [];

    for (const group of groups) {
      const name = this.requiredTrimmed(group.name, 'group.name');
      const key = name.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      normalized.push({
        name,
        externalId: this.optionalTrimmed(group.externalId),
        mappedRoleKey: this.optionalTrimmed(group.mappedRoleKey),
      });
    }

    return normalized;
  }

  private normalizeUsers(
    users: Array<{
      externalId?: string;
      email: string;
      displayName?: string;
      groups?: string[];
      mappedRoleKey?: string;
    }>,
  ): Array<{
    externalId: string | null;
    email: string;
    displayName: string | null;
    groups: string[];
    mappedRoleKey: string | null;
  }> {
    const seen = new Set<string>();
    const normalized: Array<{
      externalId: string | null;
      email: string;
      displayName: string | null;
      groups: string[];
      mappedRoleKey: string | null;
    }> = [];

    for (const user of users) {
      const email = this.requiredTrimmed(
        user.email,
        'user.email',
      ).toLowerCase();
      if (seen.has(email)) {
        continue;
      }
      seen.add(email);
      normalized.push({
        externalId: this.optionalTrimmed(user.externalId),
        email,
        displayName: this.optionalTrimmed(user.displayName),
        groups: this.normalizeStringArray(user.groups),
        mappedRoleKey: this.optionalTrimmed(user.mappedRoleKey),
      });
    }

    return normalized;
  }

  private normalizeRoleMappings(value: unknown): Record<string, string[]> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    const roleMappings: Record<string, string[]> = {};
    for (const [key, rawRoles] of Object.entries(
      value as Record<string, unknown>,
    )) {
      const normalizedKey = key.trim();
      if (!normalizedKey) continue;

      let roles: string[] = [];
      if (Array.isArray(rawRoles)) {
        roles = rawRoles
          .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
          .filter((entry) => entry.length > 0);
      } else if (typeof rawRoles === 'string') {
        const role = rawRoles.trim();
        if (role) {
          roles = [role];
        }
      }

      if (roles.length > 0) {
        roleMappings[normalizedKey] = Array.from(new Set(roles));
      }
    }

    return roleMappings;
  }

  private normalizeStringArray(values?: string[]): string[] {
    if (!Array.isArray(values) || values.length === 0) return [];
    return Array.from(
      new Set(
        values.map((entry) => entry.trim()).filter((entry) => entry.length > 0),
      ),
    );
  }

  private resolveTenantId(): string {
    const context = this.tenantContext.get();
    const tenantId =
      context?.effectiveOrganizationId || context?.authenticatedOrganizationId;
    if (!tenantId) {
      throw new BadRequestException(
        'Active tenant context is required for enterprise IAM operations',
      );
    }
    return tenantId;
  }

  private requiredTrimmed(value: string, field: string): string {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new BadRequestException(`${field} is required`);
    }
    return trimmed;
  }

  private optionalTrimmed(value?: string): string | null {
    if (value === undefined) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private normalizeMetadata(
    value?: Record<string, unknown>,
  ): Prisma.InputJsonValue | undefined {
    if (!value) return undefined;
    return value as Prisma.InputJsonValue;
  }

  private normalizeOptionalStatus(
    value: string | undefined,
    allowed: ReadonlySet<string>,
  ): string | null {
    if (!value) return null;
    const normalized = value.trim().toUpperCase();
    if (!allowed.has(normalized)) {
      throw new BadRequestException(
        `Invalid value "${value}". Allowed values: ${Array.from(allowed).join(', ')}`,
      );
    }
    return normalized;
  }

  private async assertTenantActor(
    actorId: string,
    tenantId: string,
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
        select: { status: true },
      }),
    ]);

    if (!user) {
      throw new ForbiddenException('Authenticated user is not recognized');
    }

    const isPlatformAdmin = PLATFORM_ADMIN_ROLES.has(user.role);
    if (!isPlatformAdmin && membership?.status !== MembershipStatus.ACTIVE) {
      throw new ForbiddenException(
        'User must be an active tenant member for enterprise IAM operations',
      );
    }
  }

  private async assertProviderInTenant(
    providerId: string,
    tenantId: string,
  ): Promise<{
    id: string;
    organizationId: string;
    roleMappings: Prisma.JsonValue | null;
  }> {
    const provider = await this.prisma.enterpriseIdentityProvider.findUnique({
      where: { id: providerId },
      select: {
        id: true,
        organizationId: true,
        roleMappings: true,
      },
    });
    if (!provider || provider.organizationId !== tenantId) {
      throw new NotFoundException('Enterprise identity provider not found');
    }
    return provider;
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

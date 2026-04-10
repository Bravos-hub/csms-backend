import { createHash, randomBytes } from 'crypto';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { TenantContextService } from '@app/db';
import { MembershipStatus, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import {
  CreateDeveloperApiKeyDto,
  CreateDeveloperAppDto,
  DeveloperUsageQueryDto,
  ListDeveloperAppsQueryDto,
  RevokeDeveloperApiKeyDto,
  UpdateDeveloperAppDto,
} from './dto/developer-platform.dto';

const PLATFORM_ADMIN_ROLES = new Set<UserRole>([
  UserRole.SUPER_ADMIN,
  UserRole.EVZONE_ADMIN,
]);

const APP_STATUS = new Set(['ACTIVE', 'DISABLED', 'ARCHIVED']);

export type DeveloperApiKeyContext = {
  appId: string;
  apiKeyId: string;
  organizationId: string;
  scopes: string[];
  rateLimitPerMin: number;
};

@Injectable()
export class DeveloperPlatformService {
  private readonly logger = new Logger(DeveloperPlatformService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async getOverview(actorId: string): Promise<Record<string, unknown>> {
    const tenantId = this.resolveTenantId();
    await this.assertTenantActor(actorId, tenantId);

    const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [
      appCount,
      activeAppCount,
      keyCount,
      activeKeyCount,
      usageRows,
      apps,
    ] = await Promise.all([
      this.prisma.developerApp.count({
        where: { organizationId: tenantId },
      }),
      this.prisma.developerApp.count({
        where: { organizationId: tenantId, status: 'ACTIVE' },
      }),
      this.prisma.developerApiKey.count({
        where: { organizationId: tenantId },
      }),
      this.prisma.developerApiKey.count({
        where: { organizationId: tenantId, status: 'ACTIVE' },
      }),
      this.prisma.developerApiUsage.findMany({
        where: {
          organizationId: tenantId,
          windowStart: { gte: windowStart },
        },
        orderBy: [{ windowStart: 'desc' }],
        take: 500,
      }),
      this.prisma.developerApp.findMany({
        where: { organizationId: tenantId },
        include: {
          apiKeys: {
            orderBy: [{ updatedAt: 'desc' }],
            take: 10,
          },
        },
        orderBy: [{ updatedAt: 'desc' }],
        take: 50,
      }),
    ]);

    const usageSummary = usageRows.reduce(
      (acc, row) => {
        acc.requests += row.requestCount;
        acc.denied += row.deniedCount;
        return acc;
      },
      { requests: 0, denied: 0 },
    );

    return {
      metrics: {
        appCount,
        activeAppCount,
        keyCount,
        activeKeyCount,
        requestsLast24h: usageSummary.requests,
        deniedLast24h: usageSummary.denied,
      },
      apps: apps.map((app) => ({
        ...app,
        apiKeys: app.apiKeys.map((key) => this.toApiKeySummary(key)),
      })),
      usage: usageRows.slice(0, 100),
      onboarding: this.buildOnboardingPayload(),
    };
  }

  async listApps(
    actorId: string,
    query: ListDeveloperAppsQueryDto,
  ): Promise<Record<string, unknown>[]> {
    const tenantId = this.resolveTenantId();
    await this.assertTenantActor(actorId, tenantId);

    const search = this.optionalTrimmed(query.search);
    const status = this.normalizeOptionalStatus(query.status, APP_STATUS);

    return this.prisma.developerApp.findMany({
      where: {
        organizationId: tenantId,
        ...(status ? { status } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { slug: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: {
        apiKeys: {
          orderBy: [{ updatedAt: 'desc' }],
          take: 25,
        },
      },
      orderBy: [{ updatedAt: 'desc' }],
    });
  }

  async createApp(
    actorId: string,
    dto: CreateDeveloperAppDto,
  ): Promise<Record<string, unknown>> {
    const tenantId = this.resolveTenantId();
    await this.assertTenantActor(actorId, tenantId);

    const name = this.requiredTrimmed(dto.name, 'name');
    const slug =
      this.optionalTrimmed(dto.slug) ||
      this.slugify(name) ||
      this.fallbackSlug();
    const defaultRateLimitPerMin = this.normalizeRateLimit(
      dto.defaultRateLimitPerMin,
      120,
    );

    try {
      const created = await this.prisma.developerApp.create({
        data: {
          organizationId: tenantId,
          name,
          slug,
          description: this.optionalTrimmed(dto.description),
          status:
            this.normalizeOptionalStatus(dto.status, APP_STATUS) || 'ACTIVE',
          defaultRateLimitPerMin,
          metadata: this.normalizeMetadata(dto.metadata),
          createdBy: actorId,
          updatedBy: actorId,
        },
      });
      await this.recordAuditEvent({
        actorId,
        action: 'DEVELOPER_APP_CREATED',
        resource: 'DeveloperApp',
        resourceId: created.id,
        details: {
          tenantId,
          status: created.status,
          defaultRateLimitPerMin: created.defaultRateLimitPerMin,
          slug: created.slug,
        },
      });
      return created;
    } catch (error) {
      this.handleKnownPrismaError(
        error,
        'Developer app slug must be unique per tenant',
      );
      await this.recordAuditEvent({
        actorId,
        action: 'DEVELOPER_APP_CREATE_FAILED',
        resource: 'DeveloperApp',
        details: {
          tenantId,
          slug,
          name,
        },
        status: 'FAILED',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async updateApp(
    actorId: string,
    appId: string,
    dto: UpdateDeveloperAppDto,
  ): Promise<Record<string, unknown>> {
    const tenantId = this.resolveTenantId();
    await this.assertTenantActor(actorId, tenantId);
    await this.assertAppInTenant(appId, tenantId);

    const updated = await this.prisma.developerApp.update({
      where: { id: appId },
      data: {
        ...(dto.name !== undefined
          ? { name: this.requiredTrimmed(dto.name, 'name') }
          : {}),
        ...(dto.description !== undefined
          ? { description: this.optionalTrimmed(dto.description) }
          : {}),
        ...(dto.status !== undefined
          ? {
              status:
                this.normalizeOptionalStatus(dto.status, APP_STATUS) ||
                'ACTIVE',
            }
          : {}),
        ...(dto.defaultRateLimitPerMin !== undefined
          ? {
              defaultRateLimitPerMin: this.normalizeRateLimit(
                dto.defaultRateLimitPerMin,
                120,
              ),
            }
          : {}),
        ...(dto.metadata !== undefined
          ? { metadata: this.normalizeMetadata(dto.metadata) }
          : {}),
        updatedBy: actorId,
      },
    });
    await this.recordAuditEvent({
      actorId,
      action: 'DEVELOPER_APP_UPDATED',
      resource: 'DeveloperApp',
      resourceId: updated.id,
      details: {
        tenantId,
        status: updated.status,
        defaultRateLimitPerMin: updated.defaultRateLimitPerMin,
      },
    });
    return updated;
  }

  async createApiKey(
    actorId: string,
    appId: string,
    dto: CreateDeveloperApiKeyDto,
  ): Promise<Record<string, unknown>> {
    const tenantId = this.resolveTenantId();
    await this.assertTenantActor(actorId, tenantId);
    const app = await this.assertAppInTenant(appId, tenantId);

    if (app.status !== 'ACTIVE') {
      throw new BadRequestException(
        'API keys can only be issued for ACTIVE developer apps',
      );
    }

    const keyPrefix = `evz_${randomBytes(8).toString('hex')}`;
    const secret = randomBytes(24).toString('base64url');
    const secretSalt = randomBytes(16).toString('hex');
    const secretHash = this.hashSecret(secret, secretSalt);

    const key = await this.prisma.developerApiKey.create({
      data: {
        appId: app.id,
        organizationId: tenantId,
        name: this.requiredTrimmed(dto.name, 'name'),
        keyPrefix,
        secretHash,
        secretSalt,
        scopes: this.normalizeScopes(dto.scopes),
        rateLimitPerMin: this.normalizeRateLimit(
          dto.rateLimitPerMin,
          app.defaultRateLimitPerMin,
        ),
        status: 'ACTIVE',
        metadata: this.normalizeMetadata(dto.metadata),
        createdBy: actorId,
        updatedBy: actorId,
      },
    });
    await this.recordAuditEvent({
      actorId,
      action: 'DEVELOPER_API_KEY_CREATED',
      resource: 'DeveloperApiKey',
      resourceId: key.id,
      details: {
        tenantId,
        appId: app.id,
        keyPrefix: key.keyPrefix,
        status: key.status,
        rateLimitPerMin: key.rateLimitPerMin,
      },
    });

    return {
      ...this.toApiKeySummary(key),
      apiKey: `${keyPrefix}.${secret}`,
      revealOnce: true,
    };
  }

  async revokeApiKey(
    actorId: string,
    apiKeyId: string,
    dto: RevokeDeveloperApiKeyDto,
  ): Promise<Record<string, unknown>> {
    const tenantId = this.resolveTenantId();
    await this.assertTenantActor(actorId, tenantId);
    const apiKey = await this.assertApiKeyInTenant(apiKeyId, tenantId);

    const updated = await this.prisma.developerApiKey.update({
      where: { id: apiKey.id },
      data: {
        status: 'REVOKED',
        revokedAt: new Date(),
        metadata: {
          ...this.ensureRecord(apiKey.metadata),
          revokedBy: actorId,
          revokedReason: this.optionalTrimmed(dto.reason),
        } as Prisma.InputJsonValue,
        updatedBy: actorId,
      },
    });
    await this.recordAuditEvent({
      actorId,
      action: 'DEVELOPER_API_KEY_REVOKED',
      resource: 'DeveloperApiKey',
      resourceId: updated.id,
      details: {
        tenantId,
        keyPrefix: updated.keyPrefix,
        reason: this.optionalTrimmed(dto.reason),
      },
    });

    return this.toApiKeySummary(updated);
  }

  async getUsage(
    actorId: string,
    query: DeveloperUsageQueryDto,
  ): Promise<Record<string, unknown>> {
    const tenantId = this.resolveTenantId();
    await this.assertTenantActor(actorId, tenantId);

    const hours = this.normalizeWindowHours(query.windowHours);
    const windowStart = new Date(Date.now() - hours * 60 * 60 * 1000);

    if (query.appId) {
      await this.assertAppInTenant(query.appId, tenantId);
    }
    if (query.apiKeyId) {
      await this.assertApiKeyInTenant(query.apiKeyId, tenantId);
    }

    const rows = await this.prisma.developerApiUsage.findMany({
      where: {
        organizationId: tenantId,
        windowStart: { gte: windowStart },
        ...(query.appId ? { appId: query.appId } : {}),
        ...(query.apiKeyId ? { apiKeyId: query.apiKeyId } : {}),
      },
      include: {
        app: {
          select: { id: true, name: true, slug: true },
        },
        apiKey: {
          select: { id: true, name: true, keyPrefix: true },
        },
      },
      orderBy: [{ windowStart: 'desc' }],
      take: 2000,
    });

    const totals = rows.reduce(
      (acc, row) => {
        acc.requests += row.requestCount;
        acc.denied += row.deniedCount;
        return acc;
      },
      { requests: 0, denied: 0 },
    );

    const byApp = new Map<
      string,
      {
        appId: string;
        appName: string;
        requests: number;
        denied: number;
      }
    >();
    for (const row of rows) {
      const key = row.appId;
      const current = byApp.get(key) || {
        appId: row.appId,
        appName: row.app.name,
        requests: 0,
        denied: 0,
      };
      current.requests += row.requestCount;
      current.denied += row.deniedCount;
      byApp.set(key, current);
    }

    return {
      windowHours: hours,
      totals,
      byApp: Array.from(byApp.values()).sort(
        (left, right) => right.requests - left.requests,
      ),
      records: rows,
    };
  }

  async getOnboarding(actorId: string): Promise<Record<string, unknown>> {
    const tenantId = this.resolveTenantId();
    await this.assertTenantActor(actorId, tenantId);
    return this.buildOnboardingPayload();
  }

  async authenticateApiKey(input: {
    rawApiKey: string;
    route: string;
    method: string;
  }): Promise<DeveloperApiKeyContext> {
    const parsed = this.parseApiKey(input.rawApiKey);
    const apiKey = await this.prisma.developerApiKey.findUnique({
      where: { keyPrefix: parsed.keyPrefix },
      include: {
        app: {
          select: {
            id: true,
            status: true,
            organizationId: true,
          },
        },
      },
    });

    if (!apiKey || apiKey.status !== 'ACTIVE') {
      throw new UnauthorizedException('Invalid API key');
    }
    if (apiKey.app.status !== 'ACTIVE') {
      throw new UnauthorizedException('Developer app is not active');
    }

    const expectedHash = this.hashSecret(parsed.secret, apiKey.secretSalt);
    if (expectedHash !== apiKey.secretHash) {
      throw new UnauthorizedException('Invalid API key');
    }

    await this.enforceRateLimit({
      apiKeyId: apiKey.id,
      appId: apiKey.appId,
      organizationId: apiKey.organizationId,
      route: input.route,
      method: input.method,
      rateLimitPerMin: apiKey.rateLimitPerMin,
    });

    await this.prisma.developerApiKey.update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date() },
    });

    return {
      apiKeyId: apiKey.id,
      appId: apiKey.appId,
      organizationId: apiKey.organizationId,
      rateLimitPerMin: apiKey.rateLimitPerMin,
      scopes: this.normalizeScopesFromJson(apiKey.scopes),
    };
  }

  async getPublicStationsSummary(
    context: DeveloperApiKeyContext,
  ): Promise<Record<string, unknown>> {
    const organizationId = context.organizationId;
    const stationWhere: Prisma.StationWhereInput = {
      OR: [{ orgId: organizationId }, { site: { organizationId } }],
    };

    const [
      stationCount,
      chargePointCount,
      onlineChargePointCount,
      activeSessionCount,
    ] = await Promise.all([
      this.prisma.station.count({ where: stationWhere }),
      this.prisma.chargePoint.count({
        where: {
          station: stationWhere,
        },
      }),
      this.prisma.chargePoint.count({
        where: {
          station: stationWhere,
          status: { in: ['ONLINE', 'ACTIVE', 'AVAILABLE', 'CHARGING'] },
        },
      }),
      this.prisma.session.count({
        where: {
          status: 'ACTIVE',
          chargePoint: {
            station: stationWhere,
          },
        },
      }),
    ]);

    return {
      apiVersion: 'v1',
      data: {
        organizationId,
        stationCount,
        chargePointCount,
        onlineChargePointCount,
        activeSessionCount,
      },
      meta: {
        appId: context.appId,
        apiKeyId: context.apiKeyId,
        rateLimitPerMin: context.rateLimitPerMin,
      },
    };
  }

  private async enforceRateLimit(input: {
    apiKeyId: string;
    appId: string;
    organizationId: string;
    route: string;
    method: string;
    rateLimitPerMin: number;
  }): Promise<void> {
    const windowStart = this.floorToMinute(new Date());
    const windowEnd = new Date(windowStart.getTime() + 60 * 1000);

    await this.prisma.developerApiUsage.upsert({
      where: {
        apiKeyId_route_method_windowStart: {
          apiKeyId: input.apiKeyId,
          route: input.route,
          method: input.method,
          windowStart,
        },
      },
      create: {
        appId: input.appId,
        apiKeyId: input.apiKeyId,
        organizationId: input.organizationId,
        route: input.route,
        method: input.method,
        windowStart,
        windowEnd,
        requestCount: 1,
        deniedCount: 0,
      },
      update: {
        requestCount: { increment: 1 },
        latestReason: null,
      },
    });

    const aggregate = await this.prisma.developerApiUsage.aggregate({
      _sum: {
        requestCount: true,
      },
      where: {
        apiKeyId: input.apiKeyId,
        windowStart,
      },
    });

    const requestsInWindow = aggregate._sum.requestCount || 0;
    if (requestsInWindow > input.rateLimitPerMin) {
      await this.prisma.developerApiUsage.update({
        where: {
          apiKeyId_route_method_windowStart: {
            apiKeyId: input.apiKeyId,
            route: input.route,
            method: input.method,
            windowStart,
          },
        },
        data: {
          deniedCount: { increment: 1 },
          latestReason: 'RATE_LIMIT_EXCEEDED',
        },
      });

      throw new HttpException(
        'API key rate limit exceeded for current minute window',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private buildOnboardingPayload(): Record<string, unknown> {
    return {
      title: 'Developer API Onboarding',
      version: 'v1',
      checklist: [
        'Create a developer app in the CPO console.',
        'Issue an API key and store it securely.',
        'Call /api/v1/developer/v1/stations/summary with x-api-key.',
        'Monitor usage and denied requests in Developer Platform analytics.',
        'Rotate and revoke keys periodically.',
      ],
      authentication: {
        header: 'x-api-key',
        format: 'evz_<prefix>.<secret>',
      },
      example: {
        endpoint: '/api/v1/developer/v1/stations/summary',
        method: 'GET',
      },
      notes: [
        'Keys are shown only once at issuance.',
        'Rate limits are enforced per key per minute.',
        'Usage analytics are aggregated in rolling windows.',
      ],
    };
  }

  private parseApiKey(rawApiKey: string): {
    keyPrefix: string;
    secret: string;
  } {
    const normalized = rawApiKey.trim();
    if (!normalized) {
      throw new UnauthorizedException('Missing API key');
    }
    const separatorIndex = normalized.indexOf('.');
    if (separatorIndex <= 0 || separatorIndex === normalized.length - 1) {
      throw new UnauthorizedException('Invalid API key format');
    }

    return {
      keyPrefix: normalized.slice(0, separatorIndex).trim(),
      secret: normalized.slice(separatorIndex + 1).trim(),
    };
  }

  private hashSecret(secret: string, salt: string): string {
    return createHash('sha256').update(salt).update(secret).digest('hex');
  }

  private toApiKeySummary(key: {
    id: string;
    appId: string;
    name: string;
    keyPrefix: string;
    scopes: Prisma.JsonValue | null;
    rateLimitPerMin: number;
    status: string;
    lastUsedAt: Date | null;
    revokedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): Record<string, unknown> {
    return {
      id: key.id,
      appId: key.appId,
      name: key.name,
      keyPrefix: key.keyPrefix,
      scopes: this.normalizeScopesFromJson(key.scopes),
      rateLimitPerMin: key.rateLimitPerMin,
      status: key.status,
      lastUsedAt: key.lastUsedAt?.toISOString() || null,
      revokedAt: key.revokedAt?.toISOString() || null,
      createdAt: key.createdAt.toISOString(),
      updatedAt: key.updatedAt.toISOString(),
    };
  }

  private normalizeScopes(
    scopes?: string[],
  ): Prisma.InputJsonValue | undefined {
    if (!Array.isArray(scopes)) return undefined;
    const normalized = Array.from(
      new Set(
        scopes.map((scope) => scope.trim()).filter((scope) => scope.length > 0),
      ),
    );
    return normalized.length > 0
      ? (normalized as Prisma.InputJsonValue)
      : undefined;
  }

  private normalizeScopesFromJson(value: Prisma.JsonValue | null): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter((entry) => entry.length > 0);
  }

  private floorToMinute(date: Date): Date {
    const value = new Date(date);
    value.setSeconds(0, 0);
    return value;
  }

  private normalizeWindowHours(value?: number): number {
    if (value === undefined || value === null) return 24;
    if (!Number.isFinite(value)) {
      throw new BadRequestException('windowHours must be a finite number');
    }
    const normalized = Math.floor(value);
    if (normalized < 1 || normalized > 168) {
      throw new BadRequestException('windowHours must be between 1 and 168');
    }
    return normalized;
  }

  private normalizeRateLimit(
    value: number | undefined,
    fallback: number,
  ): number {
    const source = value ?? fallback;
    if (!Number.isFinite(source)) {
      throw new BadRequestException(
        'rate limit must be a finite integer between 10 and 10000',
      );
    }
    const normalized = Math.floor(source);
    if (normalized < 10 || normalized > 10_000) {
      throw new BadRequestException('rate limit must be between 10 and 10000');
    }
    return normalized;
  }

  private fallbackSlug(): string {
    return `app-${randomBytes(4).toString('hex')}`;
  }

  private slugify(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+/, '')
      .replace(/-+$/, '')
      .slice(0, 80);
  }

  private resolveTenantId(): string {
    const context = this.tenantContext.get();
    const tenantId =
      context?.effectiveOrganizationId || context?.authenticatedOrganizationId;
    if (!tenantId) {
      throw new BadRequestException(
        'Active tenant context is required for developer platform operations',
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

  private ensureRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
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
        'User must be an active tenant member for developer platform operations',
      );
    }
  }

  private async assertAppInTenant(
    appId: string,
    tenantId: string,
  ): Promise<{
    id: string;
    organizationId: string;
    status: string;
    defaultRateLimitPerMin: number;
  }> {
    const app = await this.prisma.developerApp.findUnique({
      where: { id: appId },
      select: {
        id: true,
        organizationId: true,
        status: true,
        defaultRateLimitPerMin: true,
      },
    });
    if (!app || app.organizationId !== tenantId) {
      throw new NotFoundException('Developer app not found');
    }
    return app;
  }

  private async assertApiKeyInTenant(
    apiKeyId: string,
    tenantId: string,
  ): Promise<{
    id: string;
    organizationId: string;
    metadata: Prisma.JsonValue | null;
  }> {
    const apiKey = await this.prisma.developerApiKey.findUnique({
      where: { id: apiKeyId },
      select: {
        id: true,
        organizationId: true,
        metadata: true,
      },
    });
    if (!apiKey || apiKey.organizationId !== tenantId) {
      throw new NotFoundException('Developer API key not found');
    }
    return apiKey;
  }

  private handleKnownPrismaError(error: unknown, message: string): void {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new BadRequestException(message);
    }
  }

  private async recordAuditEvent(input: {
    actorId: string;
    action: string;
    resource: string;
    resourceId?: string;
    details?: Record<string, unknown>;
    status?: string;
    errorMessage?: string;
  }): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actor: input.actorId,
          action: input.action,
          resource: input.resource,
          resourceId: input.resourceId,
          details: input.details as Prisma.InputJsonValue | undefined,
          status: input.status || 'SUCCESS',
          errorMessage: input.errorMessage,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to record developer platform audit event ${input.action}`,
        String(error).replace(/[\n\r]/g, ''),
      );
    }
  }
}

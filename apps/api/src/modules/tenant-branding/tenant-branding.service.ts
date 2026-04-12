import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { TenantContextService, TenantRoutingConfigService } from '@app/db';
import {
  MembershipStatus,
  Prisma,
  TenantBrandingRevisionStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { MediaStorageService } from '../../common/services/media-storage.service';
import type { UploadBrandingAssetDto } from './dto/tenant-branding.dto';
import {
  BRANDING_FONT_OPTIONS,
  type BrandingRevisionSummary,
  type WhiteLabelConfigV1,
  WHITE_LABEL_SCHEMA_VERSION,
} from './tenant-branding.types';

type TenantBrandingOrganizationRecord = {
  id: string;
  name: string;
  logoUrl: string | null;
  tenantSubdomain: string | null;
  primaryDomain: string | null;
  whiteLabelConfig: Prisma.JsonValue | null;
  allowedOrigins: string[];
};

type BrandingStateResponse = {
  tenantId: string;
  tenantName: string;
  activeConfig: WhiteLabelConfigV1;
  draft: {
    id: string;
    version: number;
    config: WhiteLabelConfigV1;
    createdAt: string;
    updatedAt: string;
    createdBy: string | null;
    updatedBy: string | null;
  } | null;
  revisions: BrandingRevisionSummary[];
};

type PublicBrandingResponse = {
  tenantId: string | null;
  tenantName: string;
  resolvedBy: 'host_custom_domain' | 'host_subdomain' | 'default';
  config: WhiteLabelConfigV1;
};

type BrandingAssetResponse = {
  assetKind: string;
  assetUrl: string;
  source: 'upload' | 'url';
  mimeType: string | null;
  sizeBytes: number | null;
  uploadedAt: string;
};

const PLATFORM_ADMIN_ROLES = new Set<UserRole>([
  UserRole.SUPER_ADMIN,
  UserRole.EVZONE_ADMIN,
]);

const DEFAULT_PRIMARY_COLOR = '#14C78B';
const DEFAULT_ACCENT_COLOR = '#0EA672';
const DEFAULT_BORDER_RADIUS_PX = 8;
const DEFAULT_FONT_FAMILY = 'Inter';
const DEFAULT_APP_NAME = 'EVzone CPO Central';
const DEFAULT_SHORT_NAME = 'EVzone';
const MAX_ALLOWED_ORIGINS = 20;
const MAX_BRANDING_REVISIONS = 50;
const MAX_ASSET_BYTES = 5 * 1024 * 1024;
const ALLOWED_ASSET_MIME_TYPES = new Set<string>([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
  'image/x-icon',
  'image/vnd.microsoft.icon',
]);

@Injectable()
export class TenantBrandingService {
  private readonly logger = new Logger(TenantBrandingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly tenantRoutingConfig: TenantRoutingConfigService,
    private readonly mediaStorage: MediaStorageService,
  ) {}

  async getBrandingForTenantActor(
    actorId: string,
  ): Promise<BrandingStateResponse> {
    const tenantId = this.resolveTenantIdFromContext();
    await this.assertTenantActor(actorId, tenantId);
    return this.getBrandingState(tenantId);
  }

  async saveDraftForTenantActor(
    actorId: string,
    rawConfig: Record<string, unknown>,
  ): Promise<BrandingStateResponse> {
    const tenantId = this.resolveTenantIdFromContext();
    await this.assertTenantActor(actorId, tenantId);
    return this.saveDraft(actorId, tenantId, rawConfig);
  }

  async publishDraftForTenantActor(
    actorId: string,
  ): Promise<BrandingStateResponse> {
    const tenantId = this.resolveTenantIdFromContext();
    await this.assertTenantActor(actorId, tenantId);
    return this.publishDraft(actorId, tenantId);
  }

  async rollbackForTenantActor(
    actorId: string,
    version: number,
  ): Promise<BrandingStateResponse> {
    const tenantId = this.resolveTenantIdFromContext();
    await this.assertTenantActor(actorId, tenantId);
    return this.rollback(actorId, tenantId, version);
  }

  async uploadAssetForTenantActor(
    actorId: string,
    input: UploadBrandingAssetDto & { file?: Express.Multer.File },
  ): Promise<BrandingAssetResponse> {
    const tenantId = this.resolveTenantIdFromContext();
    await this.assertTenantActor(actorId, tenantId);
    return this.uploadAsset(actorId, tenantId, input);
  }

  async getBrandingForPlatformActor(
    actorId: string,
    tenantId: string,
  ): Promise<BrandingStateResponse> {
    await this.assertPlatformActor(actorId);
    await this.assertTenantExists(tenantId);
    return this.getBrandingState(tenantId);
  }

  async saveDraftForPlatformActor(
    actorId: string,
    tenantId: string,
    rawConfig: Record<string, unknown>,
  ): Promise<BrandingStateResponse> {
    await this.assertPlatformActor(actorId);
    await this.assertTenantExists(tenantId);
    return this.saveDraft(actorId, tenantId, rawConfig);
  }

  async publishDraftForPlatformActor(
    actorId: string,
    tenantId: string,
  ): Promise<BrandingStateResponse> {
    await this.assertPlatformActor(actorId);
    await this.assertTenantExists(tenantId);
    return this.publishDraft(actorId, tenantId);
  }

  async rollbackForPlatformActor(
    actorId: string,
    tenantId: string,
    version: number,
  ): Promise<BrandingStateResponse> {
    await this.assertPlatformActor(actorId);
    await this.assertTenantExists(tenantId);
    return this.rollback(actorId, tenantId, version);
  }

  async uploadAssetForPlatformActor(
    actorId: string,
    tenantId: string,
    input: UploadBrandingAssetDto & { file?: Express.Multer.File },
  ): Promise<BrandingAssetResponse> {
    await this.assertPlatformActor(actorId);
    await this.assertTenantExists(tenantId);
    return this.uploadAsset(actorId, tenantId, input);
  }

  async getPublicRuntimeBranding(input: {
    host: string | null;
    resolvedTenantId: string | null;
  }): Promise<PublicBrandingResponse> {
    const host = this.normalizeHost(input.host);
    if (host) {
      const byDomain = await this.findOrganizationByPrimaryDomain(host);
      if (byDomain) {
        return {
          tenantId: byDomain.id,
          tenantName: byDomain.name,
          resolvedBy: 'host_custom_domain',
          config: this.resolveRuntimeConfig(byDomain),
        };
      }

      const subdomain = this.resolveTenantSubdomain(host);
      if (subdomain) {
        const bySubdomain = await this.findOrganizationBySubdomain(subdomain);
        if (bySubdomain) {
          return {
            tenantId: bySubdomain.id,
            tenantName: bySubdomain.name,
            resolvedBy: 'host_subdomain',
            config: this.resolveRuntimeConfig(bySubdomain),
          };
        }
      }
    }

    const tenantIdFromContext = this.optionalTrimmed(input.resolvedTenantId);
    if (tenantIdFromContext) {
      const organization = await this.findOrganizationById(tenantIdFromContext);
      if (organization) {
        return {
          tenantId: organization.id,
          tenantName: organization.name,
          resolvedBy: 'host_subdomain',
          config: this.resolveRuntimeConfig(organization),
        };
      }
    }

    return this.buildDefaultPublicBranding();
  }

  private async getBrandingState(
    tenantId: string,
  ): Promise<BrandingStateResponse> {
    const organization = await this.requireOrganization(tenantId);
    const controlPlane = this.prisma.getControlPlaneClient();

    const [draft, revisions] = await Promise.all([
      controlPlane.tenantBrandingRevision.findFirst({
        where: {
          organizationId: tenantId,
          status: TenantBrandingRevisionStatus.DRAFT,
        },
        orderBy: [{ updatedAt: 'desc' }],
      }),
      controlPlane.tenantBrandingRevision.findMany({
        where: {
          organizationId: tenantId,
          status: {
            in: [
              TenantBrandingRevisionStatus.PUBLISHED,
              TenantBrandingRevisionStatus.ROLLED_BACK,
            ],
          },
        },
        orderBy: [{ version: 'desc' }],
        take: MAX_BRANDING_REVISIONS,
      }),
    ]);

    const activeConfig = this.resolveActiveConfig(organization);

    return {
      tenantId: organization.id,
      tenantName: organization.name,
      activeConfig,
      draft: draft
        ? {
            id: draft.id,
            version: draft.version,
            config: this.normalizeConfig(
              draft.config,
              this.buildTenantDefaultConfig(organization),
              draft.updatedBy || draft.createdBy || null,
              draft.updatedAt.toISOString(),
            ),
            createdAt: draft.createdAt.toISOString(),
            updatedAt: draft.updatedAt.toISOString(),
            createdBy: draft.createdBy || null,
            updatedBy: draft.updatedBy || null,
          }
        : null,
      revisions: revisions.map((revision) => ({
        id: revision.id,
        version: revision.version,
        status: revision.status,
        publishedAt: revision.publishedAt
          ? revision.publishedAt.toISOString()
          : null,
        rolledBackFromVersion: revision.rolledBackFromVersion || null,
        createdBy: revision.createdBy || null,
        updatedBy: revision.updatedBy || null,
        createdAt: revision.createdAt.toISOString(),
        updatedAt: revision.updatedAt.toISOString(),
      })),
    };
  }
  private async saveDraft(
    actorId: string,
    tenantId: string,
    rawConfig: Record<string, unknown>,
  ): Promise<BrandingStateResponse> {
    const normalizedActorId = this.requiredTrimmed(actorId, 'actorId');
    const organization = await this.requireOrganization(tenantId);
    const fallback = this.resolveActiveConfig(organization);
    const nowIso = new Date().toISOString();
    const config = this.normalizeConfig(
      rawConfig,
      fallback,
      normalizedActorId,
      nowIso,
    );
    const controlPlane = this.prisma.getControlPlaneClient();

    try {
      await controlPlane.$transaction(async (tx) => {
        const [existingDrafts, latestRevision] = await Promise.all([
          tx.tenantBrandingRevision.findMany({
            where: {
              organizationId: tenantId,
              status: TenantBrandingRevisionStatus.DRAFT,
            },
            orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
          }),
          tx.tenantBrandingRevision.findFirst({
            where: { organizationId: tenantId },
            orderBy: [{ version: 'desc' }],
            select: { version: true },
          }),
        ]);

        const activeDraft = existingDrafts[0] || null;
        const staleDraftIds = existingDrafts.slice(1).map((draft) => draft.id);
        if (staleDraftIds.length > 0) {
          await tx.tenantBrandingRevision.deleteMany({
            where: { id: { in: staleDraftIds } },
          });
        }

        if (activeDraft) {
          await tx.tenantBrandingRevision.update({
            where: { id: activeDraft.id },
            data: {
              config: config as unknown as Prisma.InputJsonValue,
              updatedBy: normalizedActorId,
            },
          });
          return;
        }

        const nextVersion = (latestRevision?.version || 0) + 1;
        await tx.tenantBrandingRevision.create({
          data: {
            organizationId: tenantId,
            version: nextVersion,
            status: TenantBrandingRevisionStatus.DRAFT,
            config: config as unknown as Prisma.InputJsonValue,
            createdBy: normalizedActorId,
            updatedBy: normalizedActorId,
          },
        });
      });
    } catch (error) {
      this.handleKnownPrismaError(
        error,
        'Branding draft changed concurrently. Please retry.',
      );
      throw error;
    }

    await this.recordAuditEvent({
      actorId: normalizedActorId,
      action: 'BRANDING_DRAFT_SAVED',
      tenantId,
      details: {
        tenantId,
        primaryDomain: config.domain.primaryDomain,
        allowedOrigins: config.domain.allowedOrigins,
      },
    });

    return this.getBrandingState(tenantId);
  }

  private async publishDraft(
    actorId: string,
    tenantId: string,
  ): Promise<BrandingStateResponse> {
    const normalizedActorId = this.requiredTrimmed(actorId, 'actorId');
    const controlPlane = this.prisma.getControlPlaneClient();

    const publishResult = await controlPlane.$transaction(async (tx) => {
      const organization = await this.requireOrganizationWithClient(
        tx,
        tenantId,
      );
      const draft = await tx.tenantBrandingRevision.findFirst({
        where: {
          organizationId: tenantId,
          status: TenantBrandingRevisionStatus.DRAFT,
        },
        orderBy: [{ updatedAt: 'desc' }],
      });

      if (!draft) {
        throw new BadRequestException(
          'No draft branding configuration found to publish',
        );
      }

      const normalized = this.normalizeConfig(
        draft.config,
        this.resolveActiveConfig(organization),
        normalizedActorId,
        new Date().toISOString(),
      );

      const previousDomain = organization.primaryDomain;

      await tx.organization.update({
        where: { id: tenantId },
        data: this.toOrganizationBrandingUpdate(normalized),
      });

      await tx.tenantBrandingRevision.update({
        where: { id: draft.id },
        data: {
          status: TenantBrandingRevisionStatus.PUBLISHED,
          publishedAt: new Date(),
          updatedBy: normalizedActorId,
          config: normalized as unknown as Prisma.InputJsonValue,
        },
      });

      return {
        version: draft.version,
        previousDomain,
        currentDomain: normalized.domain.primaryDomain,
        allowedOrigins: normalized.domain.allowedOrigins,
      };
    });

    await this.recordAuditEvent({
      actorId: normalizedActorId,
      action: 'BRANDING_PUBLISHED',
      tenantId,
      details: {
        tenantId,
        version: publishResult.version,
        primaryDomain: publishResult.currentDomain,
        allowedOrigins: publishResult.allowedOrigins,
      },
    });

    if (publishResult.previousDomain !== publishResult.currentDomain) {
      await this.recordAuditEvent({
        actorId: normalizedActorId,
        action: 'BRANDING_DOMAIN_UPDATED',
        tenantId,
        details: {
          tenantId,
          previousDomain: publishResult.previousDomain,
          currentDomain: publishResult.currentDomain,
        },
      });
    }

    return this.getBrandingState(tenantId);
  }

  private async rollback(
    actorId: string,
    tenantId: string,
    version: number,
  ): Promise<BrandingStateResponse> {
    const normalizedActorId = this.requiredTrimmed(actorId, 'actorId');
    const normalizedVersion = this.normalizeVersion(version);
    const controlPlane = this.prisma.getControlPlaneClient();

    const rollbackResult = await controlPlane.$transaction(async (tx) => {
      const organization = await this.requireOrganizationWithClient(
        tx,
        tenantId,
      );

      const targetRevision = await tx.tenantBrandingRevision.findFirst({
        where: {
          organizationId: tenantId,
          version: normalizedVersion,
          status: {
            in: [
              TenantBrandingRevisionStatus.PUBLISHED,
              TenantBrandingRevisionStatus.ROLLED_BACK,
            ],
          },
        },
      });

      if (!targetRevision) {
        throw new NotFoundException(
          'Requested published branding version was not found',
        );
      }

      const normalized = this.normalizeConfig(
        targetRevision.config,
        this.resolveActiveConfig(organization),
        normalizedActorId,
        new Date().toISOString(),
      );

      const latestRevision = await tx.tenantBrandingRevision.findFirst({
        where: { organizationId: tenantId },
        orderBy: [{ version: 'desc' }],
        select: { version: true },
      });
      const nextVersion = (latestRevision?.version || 0) + 1;

      await tx.organization.update({
        where: { id: tenantId },
        data: this.toOrganizationBrandingUpdate(normalized),
      });

      await tx.tenantBrandingRevision.create({
        data: {
          organizationId: tenantId,
          version: nextVersion,
          status: TenantBrandingRevisionStatus.ROLLED_BACK,
          config: normalized as unknown as Prisma.InputJsonValue,
          publishedAt: new Date(),
          rolledBackFromVersion: normalizedVersion,
          createdBy: normalizedActorId,
          updatedBy: normalizedActorId,
        },
      });

      return {
        rolledBackToVersion: normalizedVersion,
        promotedVersion: nextVersion,
        previousDomain: organization.primaryDomain,
        currentDomain: normalized.domain.primaryDomain,
      };
    });

    await this.recordAuditEvent({
      actorId: normalizedActorId,
      action: 'BRANDING_ROLLED_BACK',
      tenantId,
      details: {
        tenantId,
        rolledBackToVersion: rollbackResult.rolledBackToVersion,
        promotedVersion: rollbackResult.promotedVersion,
      },
    });

    if (rollbackResult.previousDomain !== rollbackResult.currentDomain) {
      await this.recordAuditEvent({
        actorId: normalizedActorId,
        action: 'BRANDING_DOMAIN_UPDATED',
        tenantId,
        details: {
          tenantId,
          previousDomain: rollbackResult.previousDomain,
          currentDomain: rollbackResult.currentDomain,
        },
      });
    }

    return this.getBrandingState(tenantId);
  }

  private async uploadAsset(
    actorId: string,
    tenantId: string,
    input: UploadBrandingAssetDto & { file?: Express.Multer.File },
  ): Promise<BrandingAssetResponse> {
    const normalizedActorId = this.requiredTrimmed(actorId, 'actorId');
    const assetKind = this.requiredTrimmed(input.assetKind, 'assetKind');
    const file = input.file;
    const assetUrl = this.optionalTrimmed(input.assetUrl);

    if (file && assetUrl) {
      throw new BadRequestException(
        'Provide either a file upload or assetUrl, not both',
      );
    }

    if (!file && !assetUrl) {
      throw new BadRequestException('A file or assetUrl is required');
    }

    let response: BrandingAssetResponse;

    if (assetUrl) {
      const normalizedUrl = this.normalizeOptionalUrl(assetUrl, 'assetUrl');
      if (!normalizedUrl) {
        throw new BadRequestException('assetUrl must be a valid http(s) URL');
      }

      response = {
        assetKind,
        assetUrl: normalizedUrl,
        source: 'url',
        mimeType: null,
        sizeBytes: null,
        uploadedAt: new Date().toISOString(),
      };
    } else {
      if (!file?.buffer) {
        throw new BadRequestException('Uploaded file payload is empty');
      }

      if (!ALLOWED_ASSET_MIME_TYPES.has(file.mimetype)) {
        throw new BadRequestException(
          `Unsupported asset type ${file.mimetype}. Allowed types: ${Array.from(ALLOWED_ASSET_MIME_TYPES).join(', ')}`,
        );
      }

      if (file.size > MAX_ASSET_BYTES) {
        throw new BadRequestException(
          `Asset file exceeds ${MAX_ASSET_BYTES} bytes`,
        );
      }

      const uploaded = await this.mediaStorage.uploadBuffer({
        buffer: file.buffer,
        folder: `tenant-branding/${tenantId}/${assetKind}`,
        resourceType: 'image',
        context: `tenant_id=${tenantId}|asset_kind=${assetKind}`,
      });

      response = {
        assetKind,
        assetUrl: uploaded.url,
        source: 'upload',
        mimeType: file.mimetype,
        sizeBytes: uploaded.bytes,
        uploadedAt: new Date().toISOString(),
      };
    }

    await this.recordAuditEvent({
      actorId: normalizedActorId,
      action: 'BRANDING_ASSET_UPLOADED',
      tenantId,
      details: {
        tenantId,
        assetKind,
        source: response.source,
        assetUrl: response.assetUrl,
        mimeType: response.mimeType,
        sizeBytes: response.sizeBytes,
      },
    });

    return response;
  }

  private resolveTenantIdFromContext(): string {
    const context = this.tenantContext.get();
    const tenantId =
      context?.effectiveOrganizationId || context?.authenticatedOrganizationId;

    if (!tenantId) {
      throw new BadRequestException(
        'Active tenant context is required for branding operations',
      );
    }

    return tenantId;
  }

  private buildDefaultPublicBranding(): PublicBrandingResponse {
    return {
      tenantId: null,
      tenantName: DEFAULT_SHORT_NAME,
      resolvedBy: 'default',
      config: this.buildEvzoneDefaultConfig(),
    };
  }

  private resolveActiveConfig(
    organization: TenantBrandingOrganizationRecord,
  ): WhiteLabelConfigV1 {
    const fallback = this.buildTenantDefaultConfig(organization);
    if (!organization.whiteLabelConfig) {
      return fallback;
    }

    try {
      return this.normalizeConfig(
        organization.whiteLabelConfig,
        fallback,
        null,
        null,
      );
    } catch {
      this.logger.warn(
        `Invalid active branding config for tenant ${organization.id}; returning tenant defaults`,
      );
      return fallback;
    }
  }

  private resolveRuntimeConfig(
    organization: TenantBrandingOrganizationRecord,
  ): WhiteLabelConfigV1 {
    if (!organization.whiteLabelConfig) {
      return this.buildEvzoneDefaultConfig();
    }

    if (!this.hasCompleteRuntimeConfigShape(organization.whiteLabelConfig)) {
      this.logger.warn(
        `Incomplete runtime branding config for tenant ${organization.id}; falling back to EVzone defaults`,
      );
      return this.buildEvzoneDefaultConfig();
    }

    try {
      return this.normalizeConfig(
        organization.whiteLabelConfig,
        this.buildEvzoneDefaultConfig(),
        null,
        null,
      );
    } catch {
      this.logger.warn(
        `Invalid runtime branding config for tenant ${organization.id}; falling back to EVzone defaults`,
      );
      return this.buildEvzoneDefaultConfig();
    }
  }
  private buildEvzoneDefaultConfig(): WhiteLabelConfigV1 {
    return {
      schemaVersion: WHITE_LABEL_SCHEMA_VERSION,
      branding: {
        appName: DEFAULT_APP_NAME,
        shortName: DEFAULT_SHORT_NAME,
        logoUrl: null,
        logoIconUrl: null,
        faviconUrl: null,
      },
      theme: {
        primaryColor: DEFAULT_PRIMARY_COLOR,
        accentColor: DEFAULT_ACCENT_COLOR,
        borderRadiusPx: DEFAULT_BORDER_RADIUS_PX,
        fontFamily: DEFAULT_FONT_FAMILY,
      },
      legal: {
        termsUrl: null,
        privacyUrl: null,
        supportUrl: null,
      },
      support: {
        email: null,
        phone: null,
      },
      domain: {
        primaryDomain: null,
        allowedOrigins: [],
      },
      metadata: {
        lastEditedBy: null,
        lastEditedAt: null,
      },
    };
  }

  private buildTenantDefaultConfig(
    organization?: TenantBrandingOrganizationRecord,
  ): WhiteLabelConfigV1 {
    const base = this.buildEvzoneDefaultConfig();
    if (!organization) {
      return base;
    }

    const tenantName = this.optionalTrimmed(organization.name);
    const shortName = tenantName ? tenantName.slice(0, 32) : DEFAULT_SHORT_NAME;

    return {
      ...base,
      branding: {
        ...base.branding,
        appName: tenantName || base.branding.appName,
        shortName: shortName || base.branding.shortName,
        logoUrl: this.normalizeOptionalUrl(organization.logoUrl, 'logoUrl'),
      },
      domain: {
        primaryDomain: this.normalizeDomain(organization.primaryDomain),
        allowedOrigins: this.normalizeOrigins(
          organization.allowedOrigins,
          'allowedOrigins',
          true,
        ),
      },
    };
  }

  private normalizeConfig(
    rawConfig: unknown,
    fallback: WhiteLabelConfigV1,
    lastEditedBy: string | null,
    lastEditedAtIso: string | null,
  ): WhiteLabelConfigV1 {
    const root = this.ensureRecord(rawConfig);

    const schemaVersionValue =
      root.schemaVersion === undefined
        ? fallback.schemaVersion
        : this.normalizeInteger(root.schemaVersion, 'schemaVersion');

    if (schemaVersionValue !== WHITE_LABEL_SCHEMA_VERSION) {
      throw new BadRequestException(
        `Unsupported branding schema version ${schemaVersionValue}`,
      );
    }

    const brandingSection = this.ensureRecord(root.branding);
    const themeSection = this.ensureRecord(root.theme);
    const legalSection = this.ensureRecord(root.legal);
    const supportSection = this.ensureRecord(root.support);
    const domainSection = this.ensureRecord(root.domain);
    const metadataSection = this.ensureRecord(root.metadata);

    const appName = this.normalizeRequiredString(
      brandingSection.appName === undefined
        ? fallback.branding.appName
        : brandingSection.appName,
      'branding.appName',
      120,
    );

    const shortName = this.normalizeRequiredString(
      brandingSection.shortName === undefined
        ? fallback.branding.shortName
        : brandingSection.shortName,
      'branding.shortName',
      48,
    );

    const primaryColor = this.normalizeColor(
      themeSection.primaryColor === undefined
        ? fallback.theme.primaryColor
        : themeSection.primaryColor,
      'theme.primaryColor',
    );

    const accentColor = this.normalizeNullableColor(
      themeSection.accentColor === undefined
        ? fallback.theme.accentColor
        : themeSection.accentColor,
      'theme.accentColor',
    );

    const borderRadiusPx = this.normalizeIntegerInRange(
      themeSection.borderRadiusPx === undefined
        ? fallback.theme.borderRadiusPx
        : themeSection.borderRadiusPx,
      'theme.borderRadiusPx',
      0,
      32,
    );

    const fontFamily = this.normalizeFontFamily(
      themeSection.fontFamily === undefined
        ? fallback.theme.fontFamily
        : themeSection.fontFamily,
    );

    const primaryDomain = this.normalizeDomain(
      domainSection.primaryDomain === undefined
        ? fallback.domain.primaryDomain
        : domainSection.primaryDomain,
    );

    const allowedOrigins = this.normalizeOrigins(
      domainSection.allowedOrigins === undefined
        ? fallback.domain.allowedOrigins
        : domainSection.allowedOrigins,
      'domain.allowedOrigins',
      false,
    );

    const computedLastEditedBy =
      lastEditedBy ||
      this.normalizeNullableShortString(
        metadataSection.lastEditedBy === undefined
          ? fallback.metadata.lastEditedBy
          : metadataSection.lastEditedBy,
        'metadata.lastEditedBy',
        120,
      );

    const computedLastEditedAt =
      lastEditedAtIso ||
      this.normalizeNullableTimestamp(
        metadataSection.lastEditedAt === undefined
          ? fallback.metadata.lastEditedAt
          : metadataSection.lastEditedAt,
        'metadata.lastEditedAt',
      );

    return {
      schemaVersion: WHITE_LABEL_SCHEMA_VERSION,
      branding: {
        appName,
        shortName,
        logoUrl: this.normalizeOptionalUrl(
          brandingSection.logoUrl === undefined
            ? fallback.branding.logoUrl
            : brandingSection.logoUrl,
          'branding.logoUrl',
        ),
        logoIconUrl: this.normalizeOptionalUrl(
          brandingSection.logoIconUrl === undefined
            ? fallback.branding.logoIconUrl
            : brandingSection.logoIconUrl,
          'branding.logoIconUrl',
        ),
        faviconUrl: this.normalizeOptionalUrl(
          brandingSection.faviconUrl === undefined
            ? fallback.branding.faviconUrl
            : brandingSection.faviconUrl,
          'branding.faviconUrl',
        ),
      },
      theme: {
        primaryColor,
        accentColor,
        borderRadiusPx,
        fontFamily,
      },
      legal: {
        termsUrl: this.normalizeOptionalUrl(
          legalSection.termsUrl === undefined
            ? fallback.legal.termsUrl
            : legalSection.termsUrl,
          'legal.termsUrl',
        ),
        privacyUrl: this.normalizeOptionalUrl(
          legalSection.privacyUrl === undefined
            ? fallback.legal.privacyUrl
            : legalSection.privacyUrl,
          'legal.privacyUrl',
        ),
        supportUrl: this.normalizeOptionalUrl(
          legalSection.supportUrl === undefined
            ? fallback.legal.supportUrl
            : legalSection.supportUrl,
          'legal.supportUrl',
        ),
      },
      support: {
        email: this.normalizeOptionalEmail(
          supportSection.email === undefined
            ? fallback.support.email
            : supportSection.email,
          'support.email',
        ),
        phone: this.normalizeOptionalPhone(
          supportSection.phone === undefined
            ? fallback.support.phone
            : supportSection.phone,
          'support.phone',
        ),
      },
      domain: {
        primaryDomain,
        allowedOrigins,
      },
      metadata: {
        lastEditedBy: computedLastEditedBy,
        lastEditedAt: computedLastEditedAt,
      },
    };
  }

  private normalizeRequiredString(
    value: unknown,
    field: string,
    maxLength: number,
  ): string {
    if (typeof value !== 'string') {
      throw new BadRequestException(`${field} must be a string`);
    }

    const normalized = value.trim();
    if (!normalized) {
      throw new BadRequestException(`${field} is required`);
    }

    if (normalized.length > maxLength) {
      throw new BadRequestException(
        `${field} must be at most ${maxLength} characters`,
      );
    }

    return normalized;
  }

  private normalizeNullableShortString(
    value: unknown,
    field: string,
    maxLength: number,
  ): string | null {
    if (value === undefined || value === null) {
      return null;
    }

    if (typeof value !== 'string') {
      throw new BadRequestException(`${field} must be a string`);
    }

    const normalized = value.trim();
    if (!normalized) {
      return null;
    }

    if (normalized.length > maxLength) {
      throw new BadRequestException(
        `${field} must be at most ${maxLength} characters`,
      );
    }

    return normalized;
  }

  private normalizeOptionalUrl(value: unknown, field: string): string | null {
    if (value === undefined || value === null) {
      return null;
    }

    if (typeof value !== 'string') {
      throw new BadRequestException(`${field} must be a string URL`);
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw new BadRequestException(`${field} must be a valid URL`);
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new BadRequestException(`${field} must use http or https`);
    }

    return parsed.toString();
  }

  private normalizeOptionalEmail(value: unknown, field: string): string | null {
    const normalized = this.normalizeNullableShortString(value, field, 200);
    if (!normalized) {
      return null;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalized)) {
      throw new BadRequestException(`${field} must be a valid email`);
    }

    return normalized.toLowerCase();
  }

  private normalizeOptionalPhone(value: unknown, field: string): string | null {
    const normalized = this.normalizeNullableShortString(value, field, 40);
    if (!normalized) {
      return null;
    }

    const phoneRegex = /^[+0-9().\-\s]{5,40}$/;
    if (!phoneRegex.test(normalized)) {
      throw new BadRequestException(`${field} must be a valid phone number`);
    }

    return normalized;
  }
  private normalizeColor(value: unknown, field: string): string {
    if (typeof value !== 'string') {
      throw new BadRequestException(`${field} must be a color string`);
    }

    const trimmed = value.trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
      throw new BadRequestException(
        `${field} must be a hex color like #14C78B`,
      );
    }

    return trimmed.toUpperCase();
  }

  private normalizeNullableColor(value: unknown, field: string): string | null {
    if (value === undefined || value === null) {
      return null;
    }

    return this.normalizeColor(value, field);
  }

  private normalizeInteger(value: unknown, field: string): number {
    const parsed =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number.parseInt(value.trim(), 10)
          : Number.NaN;

    if (!Number.isInteger(parsed)) {
      throw new BadRequestException(`${field} must be an integer`);
    }

    return parsed;
  }

  private normalizeIntegerInRange(
    value: unknown,
    field: string,
    min: number,
    max: number,
  ): number {
    const normalized = this.normalizeInteger(value, field);
    if (normalized < min || normalized > max) {
      throw new BadRequestException(
        `${field} must be between ${min} and ${max}`,
      );
    }
    return normalized;
  }

  private normalizeFontFamily(
    value: unknown,
  ): WhiteLabelConfigV1['theme']['fontFamily'] {
    if (typeof value !== 'string') {
      throw new BadRequestException('theme.fontFamily must be a string');
    }

    const normalized = value.trim();
    if (
      !BRANDING_FONT_OPTIONS.includes(
        normalized as (typeof BRANDING_FONT_OPTIONS)[number],
      )
    ) {
      throw new BadRequestException(
        `theme.fontFamily must be one of: ${BRANDING_FONT_OPTIONS.join(', ')}`,
      );
    }

    return normalized as WhiteLabelConfigV1['theme']['fontFamily'];
  }

  private normalizeDomain(value: unknown): string | null {
    if (value === undefined || value === null) {
      return null;
    }

    if (typeof value !== 'string') {
      throw new BadRequestException('domain.primaryDomain must be a string');
    }

    const trimmed = value.trim().toLowerCase();
    if (!trimmed) {
      return null;
    }

    if (trimmed.includes('://') || trimmed.includes('/')) {
      throw new BadRequestException(
        'domain.primaryDomain must be a host without protocol or path',
      );
    }

    const hostRegex =
      /^(localhost|[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*)$/;
    if (!hostRegex.test(trimmed)) {
      throw new BadRequestException('domain.primaryDomain is invalid');
    }

    return trimmed;
  }

  private normalizeOrigins(
    value: unknown,
    field: string,
    allowDropInvalid: boolean,
  ): string[] {
    if (!Array.isArray(value)) {
      throw new BadRequestException(`${field} must be an array`);
    }

    const seen = new Set<string>();
    const normalized: string[] = [];

    for (const entry of value) {
      if (typeof entry !== 'string') {
        if (allowDropInvalid) {
          continue;
        }
        throw new BadRequestException(
          `${field} must contain only origin strings`,
        );
      }

      try {
        const normalizedOrigin = this.normalizeOrigin(entry);
        if (seen.has(normalizedOrigin)) {
          continue;
        }
        seen.add(normalizedOrigin);
        normalized.push(normalizedOrigin);
      } catch (error) {
        if (allowDropInvalid) {
          continue;
        }
        throw error;
      }
    }

    if (normalized.length > MAX_ALLOWED_ORIGINS) {
      throw new BadRequestException(
        `${field} may contain at most ${MAX_ALLOWED_ORIGINS} origins`,
      );
    }

    return normalized;
  }

  private normalizeOrigin(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new BadRequestException(
        'domain.allowedOrigins entries cannot be empty',
      );
    }

    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw new BadRequestException(
        `domain.allowedOrigins entry "${value}" is not a valid URL`,
      );
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new BadRequestException(
        `domain.allowedOrigins entry "${value}" must use http or https`,
      );
    }

    return `${parsed.protocol}//${parsed.host}`.toLowerCase();
  }

  private normalizeNullableTimestamp(
    value: unknown,
    field: string,
  ): string | null {
    if (value === undefined || value === null) {
      return null;
    }

    if (typeof value !== 'string') {
      throw new BadRequestException(`${field} must be an ISO timestamp`);
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`${field} must be a valid ISO timestamp`);
    }

    return parsed.toISOString();
  }

  private hasCompleteRuntimeConfigShape(rawConfig: unknown): boolean {
    const root = this.ensureRecord(rawConfig);

    if (root.schemaVersion !== WHITE_LABEL_SCHEMA_VERSION) {
      return false;
    }

    const branding = this.ensureRecord(root.branding);
    const theme = this.ensureRecord(root.theme);
    const legal = this.ensureRecord(root.legal);
    const support = this.ensureRecord(root.support);
    const domain = this.ensureRecord(root.domain);
    const metadata = this.ensureRecord(root.metadata);

    const hasBrandingFields =
      branding.appName !== undefined &&
      branding.shortName !== undefined &&
      branding.logoUrl !== undefined &&
      branding.logoIconUrl !== undefined &&
      branding.faviconUrl !== undefined;

    const hasThemeFields =
      theme.primaryColor !== undefined &&
      theme.accentColor !== undefined &&
      theme.borderRadiusPx !== undefined &&
      theme.fontFamily !== undefined;

    const hasLegalFields =
      legal.termsUrl !== undefined &&
      legal.privacyUrl !== undefined &&
      legal.supportUrl !== undefined;

    const hasSupportFields =
      support.email !== undefined && support.phone !== undefined;

    const hasDomainFields =
      domain.primaryDomain !== undefined && domain.allowedOrigins !== undefined;

    const hasMetadataFields =
      metadata.lastEditedBy !== undefined &&
      metadata.lastEditedAt !== undefined;

    return (
      hasBrandingFields &&
      hasThemeFields &&
      hasLegalFields &&
      hasSupportFields &&
      hasDomainFields &&
      hasMetadataFields
    );
  }

  private toOrganizationBrandingUpdate(
    config: WhiteLabelConfigV1,
  ): Prisma.OrganizationUpdateInput {
    return {
      whiteLabelConfig: config as unknown as Prisma.InputJsonValue,
      logoUrl: config.branding.logoUrl,
      primaryDomain: config.domain.primaryDomain,
      allowedOrigins: config.domain.allowedOrigins,
    };
  }

  private normalizeVersion(value: number): number {
    if (!Number.isInteger(value) || value < 1) {
      throw new BadRequestException('version must be a positive integer');
    }
    return value;
  }

  private normalizeHost(value: string | null): string | null {
    if (!value) return null;

    const first = value.split(',')[0]?.trim().toLowerCase();
    if (!first) return null;

    if (first.startsWith('[')) {
      return first.replace(/:\d+$/, '');
    }

    return first.replace(/:\d+$/, '');
  }

  private resolveTenantSubdomain(host: string): string | null {
    const configuredRoots = this.tenantRoutingConfig.getPlatformHosts();

    for (const root of configuredRoots) {
      if (!root) continue;
      const normalizedRoot = root.toLowerCase();
      if (host === normalizedRoot) {
        return null;
      }

      const suffix = `.${normalizedRoot}`;
      if (!host.endsWith(suffix)) {
        continue;
      }

      const prefix = host.slice(0, -suffix.length);
      if (!prefix) {
        return null;
      }

      const firstLabel = prefix.split('.')[0]?.trim().toLowerCase();
      if (!firstLabel || !/^[a-z0-9-]+$/.test(firstLabel)) {
        return null;
      }

      return firstLabel;
    }

    if (host.endsWith('.localhost')) {
      const first = host.split('.')[0]?.trim().toLowerCase();
      if (first && /^[a-z0-9-]+$/.test(first)) {
        return first;
      }
    }

    return null;
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
        'User must be an active tenant member for branding operations',
      );
    }
  }

  private async assertPlatformActor(actorId: string): Promise<void> {
    const normalizedActorId = this.requiredTrimmed(actorId, 'actorId');
    const user = await this.prisma.getControlPlaneClient().user.findUnique({
      where: { id: normalizedActorId },
      select: { role: true },
    });

    if (!user || !PLATFORM_ADMIN_ROLES.has(user.role)) {
      throw new ForbiddenException(
        'Platform admin role is required for cross-tenant branding operations',
      );
    }
  }

  private async assertTenantExists(tenantId: string): Promise<void> {
    await this.requireOrganization(tenantId);
  }

  private async requireOrganization(
    tenantId: string,
  ): Promise<TenantBrandingOrganizationRecord> {
    const organization = await this.findOrganizationById(tenantId);
    if (!organization) {
      throw new NotFoundException('Tenant not found');
    }
    return organization;
  }

  private async requireOrganizationWithClient(
    client: Prisma.TransactionClient,
    tenantId: string,
  ): Promise<TenantBrandingOrganizationRecord> {
    const organization = await client.organization.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        name: true,
        logoUrl: true,
        tenantSubdomain: true,
        primaryDomain: true,
        whiteLabelConfig: true,
        allowedOrigins: true,
      },
    });

    if (!organization) {
      throw new NotFoundException('Tenant not found');
    }

    return organization;
  }

  private async findOrganizationById(
    tenantId: string,
  ): Promise<TenantBrandingOrganizationRecord | null> {
    const normalizedTenantId = this.optionalTrimmed(tenantId);
    if (!normalizedTenantId) {
      return null;
    }

    return this.prisma.getControlPlaneClient().organization.findUnique({
      where: { id: normalizedTenantId },
      select: {
        id: true,
        name: true,
        logoUrl: true,
        tenantSubdomain: true,
        primaryDomain: true,
        whiteLabelConfig: true,
        allowedOrigins: true,
      },
    });
  }

  private async findOrganizationByPrimaryDomain(
    host: string,
  ): Promise<TenantBrandingOrganizationRecord | null> {
    return this.prisma.getControlPlaneClient().organization.findFirst({
      where: {
        primaryDomain: {
          equals: host,
          mode: 'insensitive',
        },
      },
      select: {
        id: true,
        name: true,
        logoUrl: true,
        tenantSubdomain: true,
        primaryDomain: true,
        whiteLabelConfig: true,
        allowedOrigins: true,
      },
    });
  }

  private async findOrganizationBySubdomain(
    subdomain: string,
  ): Promise<TenantBrandingOrganizationRecord | null> {
    return this.prisma.getControlPlaneClient().organization.findFirst({
      where: {
        tenantSubdomain: {
          equals: subdomain,
          mode: 'insensitive',
        },
      },
      select: {
        id: true,
        name: true,
        logoUrl: true,
        tenantSubdomain: true,
        primaryDomain: true,
        whiteLabelConfig: true,
        allowedOrigins: true,
      },
    });
  }

  private requiredTrimmed(value: string, field: string): string {
    const normalized = value.trim();
    if (!normalized) {
      throw new BadRequestException(`${field} is required`);
    }
    return normalized;
  }

  private optionalTrimmed(value: string | null | undefined): string | null {
    if (value === null || value === undefined) {
      return null;
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  private ensureRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
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
    tenantId: string;
    details?: Record<string, unknown>;
    status?: string;
    errorMessage?: string;
  }): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actor: input.actorId,
          action: input.action,
          resource: 'TenantBranding',
          resourceId: input.tenantId,
          details: input.details as Prisma.InputJsonValue | undefined,
          status: input.status || 'SUCCESS',
          errorMessage: input.errorMessage,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to record branding audit event ${input.action}`,
        String(error).replace(/[\n\r]/g, ''),
      );
    }
  }
}

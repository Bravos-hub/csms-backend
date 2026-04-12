import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PlatformTierPricingVersion } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import {
  CreateTierPricingDraftDto,
  TIER_CODES,
  type AccountType,
  type DeploymentModel,
  type TierCode,
} from './dto/tier-pricing.dto';

type TierPricingView = {
  id: string;
  tierCode: TierCode;
  tierLabel: string;
  deploymentModel: DeploymentModel;
  accountTypes: AccountType[];
  currency: string;
  isCustomPricing: boolean;
  monthlyPrice: number | null;
  annualPrice: number | null;
  setupFee: number | null;
  whiteLabelAvailable: boolean;
  whiteLabelMonthlyAddon: number | null;
  whiteLabelSetupFee: number | null;
  status: string;
  version: number;
  notes: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  createdBy: string | null;
  publishedBy: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type TierPricingGroup = {
  tierCode: TierCode;
  current: TierPricingView | null;
  versions: TierPricingView[];
};

type TierPricingDefaults = {
  tierLabel: string;
  deploymentModel: DeploymentModel;
  accountTypes: AccountType[];
  currency: string;
  isCustomPricing: boolean;
  monthlyPrice: number | null;
  annualPrice: number | null;
  setupFee: number | null;
  whiteLabelAvailable: boolean;
  whiteLabelMonthlyAddon: number | null;
  whiteLabelSetupFee: number | null;
};

const TIER_DEFAULTS: Record<TierCode, TierPricingDefaults> = {
  T1: {
    tierLabel: 'T1 Start',
    deploymentModel: 'SHARED_SCHEMA',
    accountTypes: ['INDIVIDUAL', 'COMPANY'],
    currency: 'USD',
    isCustomPricing: false,
    monthlyPrice: 99,
    annualPrice: 1010,
    setupFee: 0,
    whiteLabelAvailable: false,
    whiteLabelMonthlyAddon: null,
    whiteLabelSetupFee: null,
  },
  T2: {
    tierLabel: 'T2 Growth',
    deploymentModel: 'SHARED_SCHEMA',
    accountTypes: ['COMPANY'],
    currency: 'USD',
    isCustomPricing: false,
    monthlyPrice: 299,
    annualPrice: 3050,
    setupFee: 250,
    whiteLabelAvailable: false,
    whiteLabelMonthlyAddon: null,
    whiteLabelSetupFee: null,
  },
  T3: {
    tierLabel: 'T3 Scale',
    deploymentModel: 'DEDICATED_DB',
    accountTypes: ['COMPANY', 'ORGANIZATION'],
    currency: 'USD',
    isCustomPricing: false,
    monthlyPrice: 1490,
    annualPrice: 15198,
    setupFee: 2000,
    whiteLabelAvailable: true,
    whiteLabelMonthlyAddon: 350,
    whiteLabelSetupFee: 600,
  },
  T4: {
    tierLabel: 'T4 Enterprise',
    deploymentModel: 'DEDICATED_DB',
    accountTypes: ['STATE', 'ORGANIZATION', 'COMPANY'],
    currency: 'USD',
    isCustomPricing: true,
    monthlyPrice: null,
    annualPrice: null,
    setupFee: null,
    whiteLabelAvailable: true,
    whiteLabelMonthlyAddon: null,
    whiteLabelSetupFee: null,
  },
};

@Injectable()
export class PlatformTierPricingService {
  constructor(private readonly prisma: PrismaService) {}

  async listTierPricing(includeHistory = false): Promise<TierPricingGroup[]> {
    const rows = await this.prisma
      .getControlPlaneClient()
      .platformTierPricingVersion.findMany({
        where: includeHistory ? undefined : { status: 'ACTIVE' },
        orderBy: [{ tierCode: 'asc' }, { version: 'desc' }],
      });

    const groups = new Map<TierCode, TierPricingGroup>();
    for (const tierCode of TIER_CODES) {
      groups.set(tierCode, {
        tierCode,
        current: null,
        versions: [],
      });
    }

    for (const row of rows) {
      const tierCode = this.parseTierCode(row.tierCode);
      const group = groups.get(tierCode);
      if (!group) {
        continue;
      }

      const view = this.mapRow(row);
      group.versions.push(view);
      if (view.status === 'ACTIVE' && !group.current) {
        group.current = view;
      }
    }

    if (includeHistory) {
      for (const group of groups.values()) {
        if (!group.current && group.versions.length > 0) {
          group.current = group.versions[0];
        }
      }
    }

    return TIER_CODES.map(
      (tierCode) => groups.get(tierCode) as TierPricingGroup,
    );
  }

  async createDraft(
    tierCodeInput: string,
    dto: CreateTierPricingDraftDto,
    actorId: string,
  ): Promise<TierPricingView> {
    const tierCode = this.parseTierCode(tierCodeInput);

    const latest = await this.prisma
      .getControlPlaneClient()
      .platformTierPricingVersion.findFirst({
        where: { tierCode },
        orderBy: { version: 'desc' },
      });

    const nextVersion = latest ? latest.version + 1 : 1;
    const base = latest
      ? this.toDraftBase(latest)
      : {
          ...TIER_DEFAULTS[tierCode],
          notes: null as string | null,
        };

    const merged = {
      tierLabel: dto.tierLabel?.trim() || base.tierLabel,
      deploymentModel: dto.deploymentModel || base.deploymentModel,
      accountTypes: dto.accountTypes || base.accountTypes,
      currency: dto.currency?.trim() || base.currency,
      isCustomPricing:
        dto.isCustomPricing !== undefined
          ? dto.isCustomPricing
          : base.isCustomPricing,
      monthlyPrice:
        dto.monthlyPrice !== undefined ? dto.monthlyPrice : base.monthlyPrice,
      annualPrice:
        dto.annualPrice !== undefined ? dto.annualPrice : base.annualPrice,
      setupFee: dto.setupFee !== undefined ? dto.setupFee : base.setupFee,
      whiteLabelAvailable:
        dto.whiteLabelAvailable !== undefined
          ? dto.whiteLabelAvailable
          : base.whiteLabelAvailable,
      whiteLabelMonthlyAddon:
        dto.whiteLabelMonthlyAddon !== undefined
          ? dto.whiteLabelMonthlyAddon
          : base.whiteLabelMonthlyAddon,
      whiteLabelSetupFee:
        dto.whiteLabelSetupFee !== undefined
          ? dto.whiteLabelSetupFee
          : base.whiteLabelSetupFee,
      notes:
        dto.notes !== undefined ? dto.notes.trim() || null : base.notes || null,
    };

    if (!merged.isCustomPricing) {
      if (merged.monthlyPrice == null || merged.annualPrice == null) {
        throw new BadRequestException(
          'Monthly and annual prices are required unless custom pricing is enabled',
        );
      }
    }

    if (merged.isCustomPricing) {
      merged.monthlyPrice = null;
      merged.annualPrice = null;
    }

    if (!merged.whiteLabelAvailable) {
      merged.whiteLabelMonthlyAddon = null;
      merged.whiteLabelSetupFee = null;
    }

    const created = await this.prisma
      .getControlPlaneClient()
      .platformTierPricingVersion.create({
        data: {
          tierCode,
          tierLabel: merged.tierLabel,
          deploymentModel: merged.deploymentModel,
          accountTypes: merged.accountTypes,
          currency: merged.currency,
          isCustomPricing: merged.isCustomPricing,
          monthlyPrice: merged.monthlyPrice,
          annualPrice: merged.annualPrice,
          setupFee: merged.setupFee,
          whiteLabelAvailable: merged.whiteLabelAvailable,
          whiteLabelMonthlyAddon: merged.whiteLabelMonthlyAddon,
          whiteLabelSetupFee: merged.whiteLabelSetupFee,
          status: 'DRAFT',
          version: nextVersion,
          notes: merged.notes,
          createdBy: actorId,
        },
      });

    return this.mapRow(created);
  }

  async publishVersion(
    tierCodeInput: string,
    version: number,
    actorId: string,
  ): Promise<TierPricingView> {
    const tierCode = this.parseTierCode(tierCodeInput);

    return this.prisma.$transaction(async (tx) => {
      const target = await tx.platformTierPricingVersion.findUnique({
        where: {
          tierCode_version: {
            tierCode,
            version,
          },
        },
      });

      if (!target) {
        throw new NotFoundException(
          `Tier pricing version ${tierCode} v${version} not found`,
        );
      }

      if (
        !target.isCustomPricing &&
        (target.monthlyPrice === null || target.annualPrice === null)
      ) {
        throw new BadRequestException(
          'Cannot publish non-custom pricing without monthly and annual prices',
        );
      }

      const now = new Date();

      await tx.platformTierPricingVersion.updateMany({
        where: {
          tierCode,
          status: 'ACTIVE',
          id: {
            not: target.id,
          },
        },
        data: {
          status: 'ARCHIVED',
          effectiveTo: now,
        },
      });

      const published = await tx.platformTierPricingVersion.update({
        where: { id: target.id },
        data: {
          status: 'ACTIVE',
          effectiveFrom: now,
          effectiveTo: null,
          publishedBy: actorId,
          publishedAt: now,
        },
      });

      return this.mapRow(published);
    });
  }

  private toDraftBase(row: PlatformTierPricingVersion) {
    return {
      tierLabel: row.tierLabel,
      deploymentModel: row.deploymentModel as DeploymentModel,
      accountTypes: row.accountTypes as AccountType[],
      currency: row.currency,
      isCustomPricing: row.isCustomPricing,
      monthlyPrice: this.toNumber(row.monthlyPrice),
      annualPrice: this.toNumber(row.annualPrice),
      setupFee: this.toNumber(row.setupFee),
      whiteLabelAvailable: row.whiteLabelAvailable,
      whiteLabelMonthlyAddon: this.toNumber(row.whiteLabelMonthlyAddon),
      whiteLabelSetupFee: this.toNumber(row.whiteLabelSetupFee),
      notes: row.notes,
    };
  }

  private parseTierCode(value: string): TierCode {
    const normalized = value.trim().toUpperCase();
    if (TIER_CODES.includes(normalized as TierCode)) {
      return normalized as TierCode;
    }

    throw new BadRequestException(`Invalid tier code "${value}"`);
  }

  private toNumber(value: unknown): number | null {
    if (value === null || value === undefined) {
      return null;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private mapRow(row: PlatformTierPricingVersion): TierPricingView {
    return {
      id: row.id,
      tierCode: this.parseTierCode(row.tierCode),
      tierLabel: row.tierLabel,
      deploymentModel: row.deploymentModel as DeploymentModel,
      accountTypes: row.accountTypes as AccountType[],
      currency: row.currency,
      isCustomPricing: row.isCustomPricing,
      monthlyPrice: this.toNumber(row.monthlyPrice),
      annualPrice: this.toNumber(row.annualPrice),
      setupFee: this.toNumber(row.setupFee),
      whiteLabelAvailable: row.whiteLabelAvailable,
      whiteLabelMonthlyAddon: this.toNumber(row.whiteLabelMonthlyAddon),
      whiteLabelSetupFee: this.toNumber(row.whiteLabelSetupFee),
      status: row.status,
      version: row.version,
      notes: row.notes,
      effectiveFrom: row.effectiveFrom?.toISOString() || null,
      effectiveTo: row.effectiveTo?.toISOString() || null,
      createdBy: row.createdBy,
      publishedBy: row.publishedBy,
      publishedAt: row.publishedAt?.toISOString() || null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

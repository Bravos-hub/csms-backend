import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ApplicationStatus,
  MembershipStatus,
  Prisma,
  TenantOnboardingStage,
  TenantTier,
} from '@prisma/client';
import {
  CANONICAL_ROLE_DEFINITIONS,
  isCanonicalRoleKey,
  type CanonicalRoleKey,
} from '@app/domain';
import { PrismaService } from '../../prisma.service';
import { CommerceService } from '../billing/commerce.service';
import { TenantProvisioningService } from '../tenant-provisioning/tenant-provisioning.service';
import { TenantRbacService } from '../tenant-rbac/tenant-rbac.service';
import {
  AcceptEnterpriseQuoteDto,
  ActivateApplicationDto,
  ConfirmTierSelectionDto,
  CreateApplicationDto,
  CreateApplicationPaymentIntentDto,
  ListApplicationsQueryDto,
  ReviewApplicationDto,
  SyncApplicationPaymentDto,
  UpdateOwnApplicationDto,
} from './dto/application.dto';

const tenantApplicationInclude =
  Prisma.validator<Prisma.TenantApplicationInclude>()({
    site: true,
    applicant: {
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
      },
    },
    reviewer: {
      select: {
        id: true,
        name: true,
        email: true,
      },
    },
    provisionedOrganization: {
      select: {
        id: true,
        name: true,
        type: true,
        tenantSubdomain: true,
        primaryDomain: true,
        tenantTier: true,
      },
    },
  });

type TenantApplicationRecord = Prisma.TenantApplicationGetPayload<{
  include: typeof tenantApplicationInclude;
}>;

type PricingSnapshot = {
  tierCode: string;
  tierLabel: string;
  pricingVersion: number;
  currency: string;
  billingCycle: string | null;
  isCustomPricing: boolean;
  recurringAmount: number | null;
  setupFee: number | null;
  whiteLabelRequested: boolean;
  whiteLabelMonthlyAddon: number | null;
  whiteLabelSetupFee: number | null;
  dueNowAmount: number | null;
  publishedAt: string | null;
  effectiveFrom: string | null;
};

const NON_TERMINAL_STAGES: TenantOnboardingStage[] = [
  TenantOnboardingStage.SUBMITTED,
  TenantOnboardingStage.UNDER_REVIEW,
  TenantOnboardingStage.APPROVED_PENDING_TIER,
  TenantOnboardingStage.TIER_CONFIRMED_PENDING_PAYMENT,
  TenantOnboardingStage.QUOTE_PENDING,
  TenantOnboardingStage.PAYMENT_CONFIRMED_PENDING_ACTIVATION,
  TenantOnboardingStage.QUOTE_ACCEPTED_PENDING_ACTIVATION,
];

const REVIEWABLE_STAGES = new Set<TenantOnboardingStage>([
  TenantOnboardingStage.SUBMITTED,
  TenantOnboardingStage.UNDER_REVIEW,
]);

@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerce: CommerceService,
    private readonly tenantProvisioning: TenantProvisioningService,
    private readonly tenantRbac: TenantRbacService,
  ) {}

  private get controlPlane() {
    return this.prisma.getControlPlaneClient();
  }

  private parseArray(value?: string | null): string[] {
    if (!value) return [];
    try {
      const parsed: unknown = JSON.parse(value);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((item): item is string => typeof item === 'string');
    } catch {
      return [];
    }
  }

  private jsonArray(value?: string[]): string {
    if (!value || value.length === 0) {
      return '[]';
    }
    return JSON.stringify(value);
  }

  private toIso(value?: Date | null): string | null {
    return value ? value.toISOString() : null;
  }

  private normalizeOptionalString(value?: string | null): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private toMoneyNumber(
    value: Prisma.Decimal | number | null | undefined,
  ): number | null {
    if (value === null || value === undefined) {
      return null;
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return null;
    }
    return Number(parsed.toFixed(2));
  }

  private parsePricingSnapshot(
    value: Prisma.JsonValue | null | undefined,
  ): PricingSnapshot | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const candidate = value as Record<string, unknown>;
    const tierCode = candidate.tierCode;
    const tierLabel = candidate.tierLabel;
    const pricingVersion = candidate.pricingVersion;
    const currency = candidate.currency;
    const billingCycle = candidate.billingCycle;
    const isCustomPricing = candidate.isCustomPricing;
    const recurringAmount = candidate.recurringAmount;
    const setupFee = candidate.setupFee;
    const whiteLabelRequested = candidate.whiteLabelRequested;
    const whiteLabelMonthlyAddon = candidate.whiteLabelMonthlyAddon;
    const whiteLabelSetupFee = candidate.whiteLabelSetupFee;
    const dueNowAmount = candidate.dueNowAmount;
    const publishedAt = candidate.publishedAt;
    const effectiveFrom = candidate.effectiveFrom;

    if (
      typeof tierCode !== 'string' ||
      typeof tierLabel !== 'string' ||
      typeof pricingVersion !== 'number' ||
      typeof currency !== 'string' ||
      typeof isCustomPricing !== 'boolean' ||
      typeof whiteLabelRequested !== 'boolean'
    ) {
      return null;
    }

    return {
      tierCode,
      tierLabel,
      pricingVersion,
      currency,
      billingCycle: typeof billingCycle === 'string' ? billingCycle : null,
      isCustomPricing,
      recurringAmount:
        typeof recurringAmount === 'number' ? recurringAmount : null,
      setupFee: typeof setupFee === 'number' ? setupFee : null,
      whiteLabelRequested,
      whiteLabelMonthlyAddon:
        typeof whiteLabelMonthlyAddon === 'number'
          ? whiteLabelMonthlyAddon
          : null,
      whiteLabelSetupFee:
        typeof whiteLabelSetupFee === 'number' ? whiteLabelSetupFee : null,
      dueNowAmount: typeof dueNowAmount === 'number' ? dueNowAmount : null,
      publishedAt: typeof publishedAt === 'string' ? publishedAt : null,
      effectiveFrom: typeof effectiveFrom === 'string' ? effectiveFrom : null,
    };
  }

  private stageToLegacyStatus(stage: TenantOnboardingStage): ApplicationStatus {
    switch (stage) {
      case TenantOnboardingStage.SUBMITTED:
        return ApplicationStatus.PENDING_REVIEW;
      case TenantOnboardingStage.UNDER_REVIEW:
        return ApplicationStatus.UNDER_REVIEW;
      case TenantOnboardingStage.APPROVED_PENDING_TIER:
        return ApplicationStatus.APPROVED;
      case TenantOnboardingStage.TIER_CONFIRMED_PENDING_PAYMENT:
      case TenantOnboardingStage.QUOTE_PENDING:
        return ApplicationStatus.AWAITING_DEPOSIT;
      case TenantOnboardingStage.PAYMENT_CONFIRMED_PENDING_ACTIVATION:
      case TenantOnboardingStage.QUOTE_ACCEPTED_PENDING_ACTIVATION:
        return ApplicationStatus.DEPOSIT_PAID;
      case TenantOnboardingStage.COMPLETED:
        return ApplicationStatus.COMPLETED;
      case TenantOnboardingStage.REJECTED:
      default:
        return ApplicationStatus.REJECTED;
    }
  }

  private toTierRoutingModel(tierCode: string): TenantTier {
    if (tierCode === 'T1' || tierCode === 'T2') {
      return TenantTier.SHARED;
    }
    if (tierCode === 'T3' || tierCode === 'T4') {
      return TenantTier.DEDICATED_DB;
    }
    throw new BadRequestException(`Unsupported tier code "${tierCode}"`);
  }

  private ensureTenantScopedRole(roleKey: string): CanonicalRoleKey {
    if (!isCanonicalRoleKey(roleKey)) {
      throw new BadRequestException(`Invalid canonical role key "${roleKey}"`);
    }

    const definition = CANONICAL_ROLE_DEFINITIONS[roleKey];
    if (definition.permissionScope !== 'TENANT') {
      throw new BadRequestException(
        `Canonical role "${roleKey}" is not tenant scoped`,
      );
    }

    return roleKey;
  }

  private mapApplication(application: TenantApplicationRecord) {
    return {
      id: application.id,
      applicantId: application.applicantId,
      tenantType: application.tenantType,
      organizationName: application.organizationName,
      businessRegistrationNumber: application.businessRegistrationNumber,
      taxComplianceNumber: application.taxComplianceNumber,
      contactPersonName: application.contactPersonName,
      contactEmail: application.contactEmail,
      contactPhone: application.contactPhone,
      physicalAddress: application.physicalAddress,
      companyWebsite: application.companyWebsite,
      yearsInEVBusiness: application.yearsInEVBusiness,
      existingStationsOperated: application.existingStationsOperated,
      siteId: application.siteId,
      site: application.site,
      preferredLeaseModel: application.preferredLeaseModel,
      businessPlanSummary: application.businessPlanSummary,
      sustainabilityCommitments: application.sustainabilityCommitments,
      additionalServices: this.parseArray(application.additionalServices),
      estimatedStartDate: application.estimatedStartDate,
      message: application.message,
      applicantPreferredSubdomain: application.applicantPreferredSubdomain,
      applicantPreferredDomain: application.applicantPreferredDomain,
      confirmedSubdomain: application.confirmedSubdomain,
      confirmedDomain: application.confirmedDomain,
      status: application.status,
      onboardingStage: application.onboardingStage,
      selectedTierCode: application.selectedTierCode,
      selectedPricingVersion: application.selectedPricingVersion,
      selectedBillingCycle: application.selectedBillingCycle,
      pricingSnapshot: this.parsePricingSnapshot(application.pricingSnapshot),
      tierConfirmedAt: this.toIso(application.tierConfirmedAt),
      paymentIntentId: application.paymentIntentId,
      paymentStatus: application.paymentStatus,
      paymentSettledAt: this.toIso(application.paymentSettledAt),
      enterpriseQuoteStatus: application.enterpriseQuoteStatus,
      enterpriseQuoteReference: application.enterpriseQuoteReference,
      enterpriseContractSignedAt: this.toIso(
        application.enterpriseContractSignedAt,
      ),
      reviewerCanonicalRoleKey: application.reviewerCanonicalRoleKey,
      reviewedBy: application.reviewedBy,
      reviewedAt: this.toIso(application.reviewedAt),
      approvalNotes: application.approvalNotes,
      responseMessage: application.responseMessage,
      respondedAt: this.toIso(application.respondedAt),
      approvedAt: this.toIso(application.approvedAt),
      rejectedAt: this.toIso(application.rejectedAt),
      provisionedOrganizationId: application.provisionedOrganizationId,
      provisionedOrganization: application.provisionedOrganization,
      provisionedAt: this.toIso(application.provisionedAt),
      activatedBy: application.activatedBy,
      completedAt: this.toIso(application.completedAt),
      createdAt: application.createdAt.toISOString(),
      updatedAt: application.updatedAt.toISOString(),
      applicant: application.applicant,
      reviewer: application.reviewer,
    };
  }

  private async findByIdOrThrow(
    id: string,
    options?: { forUpdate?: boolean },
  ): Promise<TenantApplicationRecord> {
    const application = await this.controlPlane.tenantApplication.findUnique({
      where: { id },
      include: tenantApplicationInclude,
    });

    if (!application) {
      throw new NotFoundException('Tenant application not found');
    }

    if (options?.forUpdate) {
      await this.controlPlane.tenantApplication.findUnique({
        where: { id },
        select: { id: true },
      });
    }

    return application;
  }

  private assertApplicantOwnership(
    application: TenantApplicationRecord,
    applicantId: string,
  ): void {
    if (application.applicantId !== applicantId) {
      throw new ForbiddenException(
        'You do not have access to this tenant application',
      );
    }
  }

  private async assertDomainAvailability(input: {
    subdomain?: string | null;
    domain?: string | null;
    ignoreOrganizationId?: string | null;
  }): Promise<void> {
    const subdomain = this.normalizeOptionalString(input.subdomain);
    const domain = this.normalizeOptionalString(input.domain);
    const ignoreOrganizationId = input.ignoreOrganizationId || null;

    if (subdomain) {
      const existing = await this.controlPlane.organization.findFirst({
        where: {
          tenantSubdomain: {
            equals: subdomain,
            mode: 'insensitive',
          },
          ...(ignoreOrganizationId
            ? { id: { not: ignoreOrganizationId } }
            : undefined),
        },
        select: {
          id: true,
        },
      });

      if (existing) {
        throw new BadRequestException(
          `Subdomain "${subdomain}" is already in use`,
        );
      }
    }

    if (domain) {
      const existing = await this.controlPlane.organization.findFirst({
        where: {
          primaryDomain: {
            equals: domain,
            mode: 'insensitive',
          },
          ...(ignoreOrganizationId
            ? { id: { not: ignoreOrganizationId } }
            : undefined),
        },
        select: {
          id: true,
        },
      });

      if (existing) {
        throw new BadRequestException(`Domain "${domain}" is already in use`);
      }
    }
  }

  private assertReviewableStage(stage: TenantOnboardingStage): void {
    if (!REVIEWABLE_STAGES.has(stage)) {
      throw new BadRequestException(
        `Application cannot be reviewed from stage "${stage}"`,
      );
    }
  }

  async listForAdmin(filters?: ListApplicationsQueryDto) {
    const where: Prisma.TenantApplicationWhereInput = {};

    if (filters?.onboardingStage) {
      const normalizedStage = filters.onboardingStage.trim().toUpperCase();
      if (!(normalizedStage in TenantOnboardingStage)) {
        throw new BadRequestException(
          `Invalid onboarding stage "${filters.onboardingStage}"`,
        );
      }
      where.onboardingStage =
        normalizedStage as unknown as TenantOnboardingStage;
    }

    if (filters?.status) {
      const normalizedStatus = filters.status.trim().toUpperCase();
      if (!(normalizedStatus in ApplicationStatus)) {
        throw new BadRequestException(`Invalid status "${filters.status}"`);
      }
      where.status = normalizedStatus as unknown as ApplicationStatus;
    }

    if (filters?.applicantId?.trim()) {
      where.applicantId = filters.applicantId.trim();
    }

    const rows = await this.controlPlane.tenantApplication.findMany({
      where,
      include: tenantApplicationInclude,
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    });

    return rows.map((row) => this.mapApplication(row));
  }

  async listMine(applicantId: string) {
    const rows = await this.controlPlane.tenantApplication.findMany({
      where: { applicantId },
      include: tenantApplicationInclude,
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    });

    return rows.map((row) => this.mapApplication(row));
  }

  async getOneForApplicant(id: string, applicantId: string) {
    const application = await this.findByIdOrThrow(id);
    this.assertApplicantOwnership(application, applicantId);
    return this.mapApplication(application);
  }

  async getOneForAdmin(id: string) {
    const application = await this.findByIdOrThrow(id);
    return this.mapApplication(application);
  }

  async create(applicantId: string, dto: CreateApplicationDto) {
    const activeExisting = await this.controlPlane.tenantApplication.findFirst({
      where: {
        applicantId,
        onboardingStage: {
          in: NON_TERMINAL_STAGES,
        },
      },
      select: {
        id: true,
      },
    });

    if (activeExisting) {
      throw new BadRequestException(
        'You already have an active onboarding application',
      );
    }

    if (dto.siteId) {
      const site = await this.controlPlane.site.findUnique({
        where: { id: dto.siteId },
        select: { id: true },
      });
      if (!site) {
        throw new NotFoundException('Site not found');
      }
    }

    const created = await this.controlPlane.tenantApplication.create({
      data: {
        applicantId,
        tenantType: dto.tenantType,
        organizationName: dto.organizationName.trim(),
        businessRegistrationNumber: this.normalizeOptionalString(
          dto.businessRegistrationNumber,
        ),
        taxComplianceNumber: this.normalizeOptionalString(
          dto.taxComplianceNumber,
        ),
        contactPersonName: dto.contactPersonName.trim(),
        contactEmail: dto.contactEmail.trim().toLowerCase(),
        contactPhone: dto.contactPhone.trim(),
        physicalAddress: dto.physicalAddress.trim(),
        companyWebsite: this.normalizeOptionalString(dto.companyWebsite),
        yearsInEVBusiness: this.normalizeOptionalString(dto.yearsInEVBusiness),
        existingStationsOperated: dto.existingStationsOperated ?? null,
        siteId: this.normalizeOptionalString(dto.siteId),
        preferredLeaseModel: this.normalizeOptionalString(
          dto.preferredLeaseModel,
        ),
        businessPlanSummary: this.normalizeOptionalString(
          dto.businessPlanSummary,
        ),
        sustainabilityCommitments: this.normalizeOptionalString(
          dto.sustainabilityCommitments,
        ),
        additionalServices: this.jsonArray(dto.additionalServices),
        estimatedStartDate: this.normalizeOptionalString(
          dto.estimatedStartDate,
        ),
        message: this.normalizeOptionalString(dto.message),
        applicantPreferredSubdomain: this.normalizeOptionalString(
          dto.applicantPreferredSubdomain,
        ),
        applicantPreferredDomain: this.normalizeOptionalString(
          dto.applicantPreferredDomain,
        ),
        onboardingStage: TenantOnboardingStage.SUBMITTED,
        status: this.stageToLegacyStatus(TenantOnboardingStage.SUBMITTED),
      },
      include: tenantApplicationInclude,
    });

    return this.mapApplication(created);
  }

  async updateOwn(
    id: string,
    applicantId: string,
    dto: UpdateOwnApplicationDto,
  ) {
    const current = await this.findByIdOrThrow(id);
    this.assertApplicantOwnership(current, applicantId);

    const editableStages: TenantOnboardingStage[] = [
      TenantOnboardingStage.SUBMITTED,
      TenantOnboardingStage.UNDER_REVIEW,
      TenantOnboardingStage.APPROVED_PENDING_TIER,
    ];

    if (!editableStages.includes(current.onboardingStage)) {
      throw new BadRequestException(
        `Application cannot be updated from stage "${current.onboardingStage}"`,
      );
    }

    if (dto.siteId) {
      const site = await this.controlPlane.site.findUnique({
        where: { id: dto.siteId },
        select: { id: true },
      });
      if (!site) {
        throw new NotFoundException('Site not found');
      }
    }

    const updated = await this.controlPlane.tenantApplication.update({
      where: { id },
      data: {
        tenantType: dto.tenantType,
        organizationName:
          dto.organizationName !== undefined
            ? dto.organizationName.trim()
            : undefined,
        businessRegistrationNumber:
          dto.businessRegistrationNumber !== undefined
            ? this.normalizeOptionalString(dto.businessRegistrationNumber)
            : undefined,
        taxComplianceNumber:
          dto.taxComplianceNumber !== undefined
            ? this.normalizeOptionalString(dto.taxComplianceNumber)
            : undefined,
        contactPersonName:
          dto.contactPersonName !== undefined
            ? dto.contactPersonName.trim()
            : undefined,
        contactEmail:
          dto.contactEmail !== undefined
            ? dto.contactEmail.trim().toLowerCase()
            : undefined,
        contactPhone:
          dto.contactPhone !== undefined ? dto.contactPhone.trim() : undefined,
        physicalAddress:
          dto.physicalAddress !== undefined
            ? dto.physicalAddress.trim()
            : undefined,
        companyWebsite:
          dto.companyWebsite !== undefined
            ? this.normalizeOptionalString(dto.companyWebsite)
            : undefined,
        yearsInEVBusiness:
          dto.yearsInEVBusiness !== undefined
            ? this.normalizeOptionalString(dto.yearsInEVBusiness)
            : undefined,
        existingStationsOperated:
          dto.existingStationsOperated !== undefined
            ? dto.existingStationsOperated
            : undefined,
        siteId:
          dto.siteId !== undefined
            ? this.normalizeOptionalString(dto.siteId)
            : undefined,
        preferredLeaseModel:
          dto.preferredLeaseModel !== undefined
            ? this.normalizeOptionalString(dto.preferredLeaseModel)
            : undefined,
        businessPlanSummary:
          dto.businessPlanSummary !== undefined
            ? this.normalizeOptionalString(dto.businessPlanSummary)
            : undefined,
        sustainabilityCommitments:
          dto.sustainabilityCommitments !== undefined
            ? this.normalizeOptionalString(dto.sustainabilityCommitments)
            : undefined,
        additionalServices:
          dto.additionalServices !== undefined
            ? this.jsonArray(dto.additionalServices)
            : undefined,
        estimatedStartDate:
          dto.estimatedStartDate !== undefined
            ? this.normalizeOptionalString(dto.estimatedStartDate)
            : undefined,
        message:
          dto.message !== undefined
            ? this.normalizeOptionalString(dto.message)
            : undefined,
        applicantPreferredSubdomain:
          dto.applicantPreferredSubdomain !== undefined
            ? this.normalizeOptionalString(dto.applicantPreferredSubdomain)
            : undefined,
        applicantPreferredDomain:
          dto.applicantPreferredDomain !== undefined
            ? this.normalizeOptionalString(dto.applicantPreferredDomain)
            : undefined,
      },
      include: tenantApplicationInclude,
    });

    return this.mapApplication(updated);
  }

  async review(id: string, reviewerId: string, dto: ReviewApplicationDto) {
    const current = await this.findByIdOrThrow(id);

    if (current.onboardingStage === TenantOnboardingStage.COMPLETED) {
      throw new BadRequestException(
        'Completed applications cannot be reviewed',
      );
    }

    if (dto.action === 'UNDER_REVIEW') {
      this.assertReviewableStage(current.onboardingStage);

      const nextStage = TenantOnboardingStage.UNDER_REVIEW;
      const updated = await this.controlPlane.tenantApplication.update({
        where: { id },
        data: {
          onboardingStage: nextStage,
          status: this.stageToLegacyStatus(nextStage),
          reviewedBy: reviewerId,
          reviewedAt: new Date(),
          approvalNotes: this.normalizeOptionalString(dto.notes),
        },
        include: tenantApplicationInclude,
      });

      return this.mapApplication(updated);
    }

    if (dto.action === 'REJECT') {
      this.assertReviewableStage(current.onboardingStage);
      const rejectionReason = this.normalizeOptionalString(
        dto.rejectionReason || dto.notes,
      );
      if (!rejectionReason) {
        throw new BadRequestException('Rejection reason is required');
      }

      const rejectedStage = TenantOnboardingStage.REJECTED;
      const updated = await this.controlPlane.tenantApplication.update({
        where: { id },
        data: {
          onboardingStage: rejectedStage,
          status: this.stageToLegacyStatus(rejectedStage),
          reviewedBy: reviewerId,
          reviewedAt: new Date(),
          approvalNotes: this.normalizeOptionalString(dto.notes),
          responseMessage: rejectionReason,
          rejectedAt: new Date(),
          approvedAt: null,
        },
        include: tenantApplicationInclude,
      });

      return this.mapApplication(updated);
    }

    this.assertReviewableStage(current.onboardingStage);

    const canonicalRoleKey = dto.canonicalRoleKey
      ? this.ensureTenantScopedRole(dto.canonicalRoleKey)
      : current.reviewerCanonicalRoleKey || null;

    const confirmedSubdomain = this.normalizeOptionalString(
      dto.confirmedSubdomain || current.confirmedSubdomain,
    );
    const confirmedDomain = this.normalizeOptionalString(
      dto.confirmedDomain || current.confirmedDomain,
    );

    await this.assertDomainAvailability({
      subdomain: confirmedSubdomain,
      domain: confirmedDomain,
      ignoreOrganizationId: current.provisionedOrganizationId,
    });

    const approvedStage = TenantOnboardingStage.APPROVED_PENDING_TIER;
    const updated = await this.controlPlane.tenantApplication.update({
      where: { id },
      data: {
        onboardingStage: approvedStage,
        status: this.stageToLegacyStatus(approvedStage),
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
        approvalNotes: this.normalizeOptionalString(dto.notes),
        reviewerCanonicalRoleKey: canonicalRoleKey,
        confirmedSubdomain,
        confirmedDomain,
        approvedAt: new Date(),
        rejectedAt: null,
      },
      include: tenantApplicationInclude,
    });

    return this.mapApplication(updated);
  }

  async listPublishedTierPricingForApplicants() {
    const tiers = await this.controlPlane.platformTierPricingVersion.findMany({
      where: { status: 'ACTIVE' },
      orderBy: [{ tierCode: 'asc' }, { version: 'desc' }],
    });

    const deduped = new Map<string, (typeof tiers)[number]>();
    for (const tier of tiers) {
      if (!deduped.has(tier.tierCode)) {
        deduped.set(tier.tierCode, tier);
      }
    }

    return Array.from(deduped.values()).map((tier) => ({
      tierCode: tier.tierCode,
      tierLabel: tier.tierLabel,
      deploymentModel: tier.deploymentModel,
      accountTypes: tier.accountTypes,
      currency: tier.currency,
      isCustomPricing: tier.isCustomPricing,
      monthlyPrice: this.toMoneyNumber(tier.monthlyPrice),
      annualPrice: this.toMoneyNumber(tier.annualPrice),
      setupFee: this.toMoneyNumber(tier.setupFee),
      whiteLabelAvailable: tier.whiteLabelAvailable,
      whiteLabelMonthlyAddon: this.toMoneyNumber(tier.whiteLabelMonthlyAddon),
      whiteLabelSetupFee: this.toMoneyNumber(tier.whiteLabelSetupFee),
      version: tier.version,
      effectiveFrom: this.toIso(tier.effectiveFrom),
      publishedAt: this.toIso(tier.publishedAt),
    }));
  }

  listTenantScopedCanonicalRoles() {
    return Object.values(CANONICAL_ROLE_DEFINITIONS)
      .filter((definition) => definition.permissionScope === 'TENANT')
      .map((definition) => ({
        key: definition.key,
        label: definition.label,
        description: definition.description,
        family: definition.family,
        scopeType: definition.scopeType,
      }));
  }

  async confirmTier(
    id: string,
    applicantId: string,
    dto: ConfirmTierSelectionDto,
  ) {
    const current = await this.findByIdOrThrow(id);
    this.assertApplicantOwnership(current, applicantId);

    if (
      current.onboardingStage !== TenantOnboardingStage.APPROVED_PENDING_TIER
    ) {
      throw new BadRequestException(
        `Tier selection is not allowed in stage "${current.onboardingStage}"`,
      );
    }

    const tierCode = dto.tierCode.trim().toUpperCase();
    const pricing =
      await this.controlPlane.platformTierPricingVersion.findFirst({
        where: {
          tierCode,
          status: 'ACTIVE',
        },
        orderBy: { version: 'desc' },
      });

    if (!pricing) {
      throw new NotFoundException(
        `No active pricing found for tier "${tierCode}"`,
      );
    }

    if (
      pricing.accountTypes.length > 0 &&
      !pricing.accountTypes.includes(current.tenantType)
    ) {
      throw new BadRequestException(
        `Tier "${tierCode}" does not support tenant type "${current.tenantType}"`,
      );
    }

    const whiteLabelRequested = Boolean(dto.requestWhiteLabel);
    if (whiteLabelRequested && !pricing.whiteLabelAvailable) {
      throw new BadRequestException(
        `Tier "${tierCode}" does not support white-label add-ons`,
      );
    }

    const isCustomPricing = pricing.isCustomPricing || tierCode === 'T4';
    const billingCycle = dto.billingCycle || null;

    let recurringAmount: number | null = null;
    let setupFee = this.toMoneyNumber(pricing.setupFee) || 0;
    let whiteLabelMonthlyAddon =
      this.toMoneyNumber(pricing.whiteLabelMonthlyAddon) || 0;
    let whiteLabelSetupFee =
      this.toMoneyNumber(pricing.whiteLabelSetupFee) || 0;
    let dueNowAmount: number | null = null;

    if (!isCustomPricing) {
      if (!billingCycle) {
        throw new BadRequestException(
          'Billing cycle is required for non-custom pricing tiers',
        );
      }

      recurringAmount =
        billingCycle === 'ANNUAL'
          ? this.toMoneyNumber(pricing.annualPrice)
          : this.toMoneyNumber(pricing.monthlyPrice);

      if (recurringAmount === null) {
        throw new BadRequestException(
          `Tier "${tierCode}" is missing ${billingCycle.toLowerCase()} pricing`,
        );
      }

      if (!whiteLabelRequested) {
        whiteLabelMonthlyAddon = 0;
        whiteLabelSetupFee = 0;
      }

      dueNowAmount = Number(
        (
          recurringAmount +
          setupFee +
          whiteLabelMonthlyAddon +
          whiteLabelSetupFee
        ).toFixed(2),
      );
    } else {
      recurringAmount = null;
      setupFee = 0;
      whiteLabelMonthlyAddon = whiteLabelRequested ? whiteLabelMonthlyAddon : 0;
      whiteLabelSetupFee = whiteLabelRequested ? whiteLabelSetupFee : 0;
      dueNowAmount = null;
    }

    const snapshot: PricingSnapshot = {
      tierCode,
      tierLabel: pricing.tierLabel,
      pricingVersion: pricing.version,
      currency: pricing.currency,
      billingCycle,
      isCustomPricing,
      recurringAmount,
      setupFee,
      whiteLabelRequested,
      whiteLabelMonthlyAddon: whiteLabelRequested ? whiteLabelMonthlyAddon : 0,
      whiteLabelSetupFee: whiteLabelRequested ? whiteLabelSetupFee : 0,
      dueNowAmount,
      publishedAt: this.toIso(pricing.publishedAt),
      effectiveFrom: this.toIso(pricing.effectiveFrom),
    };

    const nextStage = isCustomPricing
      ? TenantOnboardingStage.QUOTE_PENDING
      : TenantOnboardingStage.TIER_CONFIRMED_PENDING_PAYMENT;

    const updated = await this.controlPlane.tenantApplication.update({
      where: { id },
      data: {
        selectedTierCode: tierCode,
        selectedPricingVersion: pricing.version,
        selectedBillingCycle: billingCycle,
        pricingSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        tierConfirmedAt: new Date(),
        onboardingStage: nextStage,
        status: this.stageToLegacyStatus(nextStage),
        paymentIntentId: null,
        paymentStatus: isCustomPricing ? null : 'PENDING',
        paymentSettledAt: null,
        enterpriseQuoteStatus: isCustomPricing ? 'PENDING' : null,
      },
      include: tenantApplicationInclude,
    });

    return this.mapApplication(updated);
  }

  async createPaymentIntent(
    id: string,
    applicantId: string,
    dto: CreateApplicationPaymentIntentDto,
  ) {
    const current = await this.findByIdOrThrow(id);
    this.assertApplicantOwnership(current, applicantId);

    if (
      current.onboardingStage !==
      TenantOnboardingStage.TIER_CONFIRMED_PENDING_PAYMENT
    ) {
      throw new BadRequestException(
        `Payment intent creation is not allowed in stage "${current.onboardingStage}"`,
      );
    }

    const snapshot = this.parsePricingSnapshot(current.pricingSnapshot);
    if (
      !snapshot ||
      snapshot.isCustomPricing ||
      snapshot.dueNowAmount === null
    ) {
      throw new BadRequestException(
        'Payment is not available for this tier selection',
      );
    }

    if (current.paymentIntentId) {
      const existingIntent = await this.commerce.getPaymentIntent(
        current.paymentIntentId,
      );
      if (
        existingIntent &&
        !['FAILED', 'CANCELED', 'EXPIRED'].includes(existingIntent.status)
      ) {
        return {
          application: this.mapApplication(current),
          paymentIntent: existingIntent,
        };
      }
    }

    const paymentIntent = await this.commerce.createPaymentIntent(
      current.applicantId,
      {
        amount: snapshot.dueNowAmount,
        currency: snapshot.currency,
        idempotencyKey:
          dto.idempotencyKey ||
          `tenant-onboarding-${current.id}-${snapshot.pricingVersion}`,
        correlationId: dto.correlationId || `tenant-onboarding-${current.id}`,
        ttlMinutes: dto.ttlMinutes,
        metadata: {
          tenantApplicationId: current.id,
          tierCode: snapshot.tierCode,
          billingCycle: snapshot.billingCycle,
        },
      },
    );

    const isSettled = paymentIntent.status === 'SETTLED';
    const nextStage = isSettled
      ? TenantOnboardingStage.PAYMENT_CONFIRMED_PENDING_ACTIVATION
      : current.onboardingStage;

    const updated = await this.controlPlane.tenantApplication.update({
      where: { id },
      data: {
        paymentIntentId: paymentIntent.id,
        paymentStatus: paymentIntent.status,
        paymentSettledAt: isSettled ? new Date() : null,
        onboardingStage: nextStage,
        status: this.stageToLegacyStatus(nextStage),
      },
      include: tenantApplicationInclude,
    });

    return {
      application: this.mapApplication(updated),
      paymentIntent,
    };
  }

  async syncPaymentStatus(
    id: string,
    applicantId: string,
    dto: SyncApplicationPaymentDto,
  ) {
    const current = await this.findByIdOrThrow(id);
    this.assertApplicantOwnership(current, applicantId);

    const intentId = dto.paymentIntentId || current.paymentIntentId;
    if (!intentId) {
      throw new BadRequestException(
        'No payment intent is linked to this application',
      );
    }

    const intent = dto.status
      ? await this.commerce.reconcilePaymentIntent(intentId, {
          status: dto.status,
          providerReference: dto.providerReference,
          note: dto.note,
          markSettled: dto.markSettled,
        })
      : await this.commerce.getPaymentIntent(intentId);

    if (!intent) {
      throw new NotFoundException('Payment intent not found');
    }

    const isSettled = intent.status === 'SETTLED';
    const nextStage = isSettled
      ? TenantOnboardingStage.PAYMENT_CONFIRMED_PENDING_ACTIVATION
      : TenantOnboardingStage.TIER_CONFIRMED_PENDING_PAYMENT;

    const updated = await this.controlPlane.tenantApplication.update({
      where: { id },
      data: {
        paymentIntentId: intent.id,
        paymentStatus: intent.status,
        paymentSettledAt: isSettled ? new Date() : null,
        onboardingStage: nextStage,
        status: this.stageToLegacyStatus(nextStage),
      },
      include: tenantApplicationInclude,
    });

    return {
      application: this.mapApplication(updated),
      paymentIntent: intent,
    };
  }

  async acceptEnterpriseQuote(
    id: string,
    applicantId: string,
    dto: AcceptEnterpriseQuoteDto,
  ) {
    const current = await this.findByIdOrThrow(id);
    this.assertApplicantOwnership(current, applicantId);

    if (current.onboardingStage !== TenantOnboardingStage.QUOTE_PENDING) {
      throw new BadRequestException(
        `Quote acceptance is not allowed in stage "${current.onboardingStage}"`,
      );
    }

    const nextStage = TenantOnboardingStage.QUOTE_ACCEPTED_PENDING_ACTIVATION;
    const updated = await this.controlPlane.tenantApplication.update({
      where: { id },
      data: {
        onboardingStage: nextStage,
        status: this.stageToLegacyStatus(nextStage),
        enterpriseQuoteStatus: 'ACCEPTED',
        enterpriseQuoteReference: dto.quoteReference.trim(),
        enterpriseContractSignedAt: new Date(),
        responseMessage: this.normalizeOptionalString(dto.note),
      },
      include: tenantApplicationInclude,
    });

    return this.mapApplication(updated);
  }

  async activate(id: string, reviewerId: string, dto: ActivateApplicationDto) {
    const current = await this.findByIdOrThrow(id, { forUpdate: true });

    const activationStages: TenantOnboardingStage[] = [
      TenantOnboardingStage.PAYMENT_CONFIRMED_PENDING_ACTIVATION,
      TenantOnboardingStage.QUOTE_ACCEPTED_PENDING_ACTIVATION,
    ];

    if (!activationStages.includes(current.onboardingStage)) {
      throw new BadRequestException(
        `Activation is not allowed in stage "${current.onboardingStage}"`,
      );
    }

    if (!current.selectedTierCode) {
      throw new BadRequestException('Tier must be selected before activation');
    }

    const canonicalRoleKey = this.ensureTenantScopedRole(
      dto.canonicalRoleKey ||
        current.reviewerCanonicalRoleKey ||
        'TENANT_ADMIN',
    );

    const confirmedSubdomain = this.normalizeOptionalString(
      dto.confirmedSubdomain ||
        current.confirmedSubdomain ||
        current.applicantPreferredSubdomain,
    );
    const confirmedDomain = this.normalizeOptionalString(
      dto.confirmedDomain ||
        current.confirmedDomain ||
        current.applicantPreferredDomain,
    );

    await this.assertDomainAvailability({
      subdomain: confirmedSubdomain,
      domain: confirmedDomain,
      ignoreOrganizationId: current.provisionedOrganizationId,
    });

    const snapshot = this.parsePricingSnapshot(current.pricingSnapshot);
    const whiteLabelRequested = Boolean(snapshot?.whiteLabelRequested);
    const tenantTier = this.toTierRoutingModel(current.selectedTierCode);

    const organization = await this.tenantProvisioning.createTenant({
      name: current.organizationName.trim(),
      type: current.tenantType,
      tenantSubdomain: confirmedSubdomain || undefined,
      tenantTier,
      tenantRoutingEnabled: tenantTier !== TenantTier.SHARED,
      primaryDomain: confirmedDomain || undefined,
      billingPlanCode: current.selectedTierCode,
      billingStatus:
        current.onboardingStage ===
        TenantOnboardingStage.PAYMENT_CONFIRMED_PENDING_ACTIVATION
          ? 'ACTIVE'
          : 'CONTRACT_ACCEPTED',
      whiteLabelConfig: whiteLabelRequested
        ? {
            requested: true,
            source: 'tenant_application',
            tierCode: current.selectedTierCode,
          }
        : undefined,
    });

    await this.tenantRbac.assignMembership(
      organization.id,
      {
        userId: current.applicantId,
        roleKey: canonicalRoleKey,
        status: MembershipStatus.ACTIVE,
      },
      reviewerId,
    );

    await this.controlPlane.user.update({
      where: { id: current.applicantId },
      data: {
        organizationId: organization.id,
      },
    });

    const completedStage = TenantOnboardingStage.COMPLETED;
    const updated = await this.controlPlane.tenantApplication.update({
      where: { id },
      data: {
        onboardingStage: completedStage,
        status: this.stageToLegacyStatus(completedStage),
        completedAt: new Date(),
        provisionedOrganizationId: organization.id,
        provisionedAt: new Date(),
        activatedBy: reviewerId,
        reviewerCanonicalRoleKey: canonicalRoleKey,
        confirmedSubdomain,
        confirmedDomain,
      },
      include: tenantApplicationInclude,
    });

    return this.mapApplication(updated);
  }
}

import 'dotenv/config';
import {
  ApplicationStatus,
  PrismaClient,
  TenantAccountType,
  TenantOnboardingStage,
} from '@prisma/client';

type Flags = {
  dryRun: boolean;
};

function parseFlags(argv: string[]): Flags {
  return {
    dryRun: argv.includes('--dry-run'),
  };
}

function toTenantType(value?: string | null): TenantAccountType {
  const normalized = (value || 'COMPANY').trim().toUpperCase();
  if (normalized === 'INDIVIDUAL') return TenantAccountType.INDIVIDUAL;
  if (normalized === 'STATE') return TenantAccountType.STATE;
  if (normalized === 'ORGANIZATION') return TenantAccountType.ORGANIZATION;
  return TenantAccountType.COMPANY;
}

function stageFromLegacyStatus(
  status: ApplicationStatus,
): TenantOnboardingStage {
  switch (status) {
    case ApplicationStatus.PENDING_REVIEW:
    case ApplicationStatus.DRAFT:
      return TenantOnboardingStage.SUBMITTED;
    case ApplicationStatus.INFO_REQUESTED:
    case ApplicationStatus.UNDER_REVIEW:
      return TenantOnboardingStage.UNDER_REVIEW;
    case ApplicationStatus.APPROVED:
      return TenantOnboardingStage.APPROVED_PENDING_TIER;
    case ApplicationStatus.NEGOTIATING:
    case ApplicationStatus.TERMS_AGREED:
    case ApplicationStatus.AWAITING_DEPOSIT:
      return TenantOnboardingStage.TIER_CONFIRMED_PENDING_PAYMENT;
    case ApplicationStatus.DEPOSIT_PAID:
    case ApplicationStatus.LEASE_DRAFTING:
    case ApplicationStatus.LEASE_PENDING_SIGNATURE:
    case ApplicationStatus.LEASE_SIGNED:
    case ApplicationStatus.COMPLIANCE_CHECK:
      return TenantOnboardingStage.PAYMENT_CONFIRMED_PENDING_ACTIVATION;
    case ApplicationStatus.COMPLETED:
      return TenantOnboardingStage.COMPLETED;
    case ApplicationStatus.REJECTED:
    case ApplicationStatus.CANCELLED:
    case ApplicationStatus.EXPIRED:
    case ApplicationStatus.WITHDRAWN:
    default:
      return TenantOnboardingStage.REJECTED;
  }
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const prisma = new PrismaClient();

  const result = {
    dryRun: flags.dryRun,
    tenantApplicationsScanned: 0,
    tenantApplicationsUpdated: 0,
    userApplicationsScanned: 0,
    userApplicationsConverted: 0,
    skipped: 0,
  };

  try {
    const tenantApplications = await prisma.tenantApplication.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        status: true,
        onboardingStage: true,
      },
    });

    for (const application of tenantApplications) {
      result.tenantApplicationsScanned += 1;
      const derivedStage = stageFromLegacyStatus(application.status);
      if (application.onboardingStage === derivedStage) {
        result.skipped += 1;
        continue;
      }

      if (!flags.dryRun) {
        await prisma.tenantApplication.update({
          where: { id: application.id },
          data: {
            onboardingStage: derivedStage,
          },
        });
      }
      result.tenantApplicationsUpdated += 1;
    }

    const openUserApplications = await prisma.userApplication.findMany({
      where: {
        status: {
          notIn: ['APPROVED', 'REJECTED'],
        },
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
          },
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    for (const legacy of openUserApplications) {
      result.userApplicationsScanned += 1;

      const existingCanonical = await prisma.tenantApplication.findFirst({
        where: {
          applicantId: legacy.userId,
          onboardingStage: {
            in: [
              TenantOnboardingStage.SUBMITTED,
              TenantOnboardingStage.UNDER_REVIEW,
              TenantOnboardingStage.APPROVED_PENDING_TIER,
              TenantOnboardingStage.TIER_CONFIRMED_PENDING_PAYMENT,
              TenantOnboardingStage.QUOTE_PENDING,
              TenantOnboardingStage.PAYMENT_CONFIRMED_PENDING_ACTIVATION,
              TenantOnboardingStage.QUOTE_ACCEPTED_PENDING_ACTIVATION,
            ],
          },
        },
        select: { id: true },
      });

      if (existingCanonical) {
        result.skipped += 1;
        continue;
      }

      const organizationName =
        legacy.companyName?.trim() ||
        legacy.user.name?.trim() ||
        'Tenant Applicant';
      const contactName = legacy.user.name?.trim() || 'Applicant';
      const contactEmail =
        legacy.user.email?.trim().toLowerCase() ||
        `${legacy.user.id}@pending.local`;
      const contactPhone = legacy.user.phone?.trim() || 'PENDING';

      if (!flags.dryRun) {
        await prisma.tenantApplication.create({
          data: {
            applicantId: legacy.userId,
            tenantType: toTenantType(legacy.accounttype),
            organizationName,
            businessRegistrationNumber: legacy.taxId || null,
            taxComplianceNumber: legacy.taxId || null,
            contactPersonName: contactName,
            contactEmail,
            contactPhone,
            physicalAddress: 'TO_BE_CONFIRMED',
            companyWebsite: null,
            yearsInEVBusiness: null,
            existingStationsOperated: null,
            siteId: null,
            preferredLeaseModel: null,
            businessPlanSummary: null,
            sustainabilityCommitments: null,
            additionalServices: '[]',
            estimatedStartDate: null,
            message: legacy.adminNotes || null,
            onboardingStage: TenantOnboardingStage.SUBMITTED,
            status: ApplicationStatus.PENDING_REVIEW,
          },
        });
      }

      result.userApplicationsConverted += 1;
    }

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to migrate legacy onboarding records: ${message}`);
  process.exit(1);
});

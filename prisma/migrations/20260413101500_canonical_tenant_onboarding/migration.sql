DO $$ BEGIN
  CREATE TYPE "TenantAccountType" AS ENUM ('INDIVIDUAL', 'COMPANY', 'STATE', 'ORGANIZATION');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "TenantOnboardingStage" AS ENUM (
    'SUBMITTED',
    'UNDER_REVIEW',
    'APPROVED_PENDING_TIER',
    'REJECTED',
    'TIER_CONFIRMED_PENDING_PAYMENT',
    'QUOTE_PENDING',
    'PAYMENT_CONFIRMED_PENDING_ACTIVATION',
    'QUOTE_ACCEPTED_PENDING_ACTIVATION',
    'COMPLETED'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "tenant_applications"
  ADD COLUMN IF NOT EXISTS "tenantType" "TenantAccountType" NOT NULL DEFAULT 'COMPANY',
  ADD COLUMN IF NOT EXISTS "applicantPreferredSubdomain" TEXT,
  ADD COLUMN IF NOT EXISTS "applicantPreferredDomain" TEXT,
  ADD COLUMN IF NOT EXISTS "confirmedSubdomain" TEXT,
  ADD COLUMN IF NOT EXISTS "confirmedDomain" TEXT,
  ADD COLUMN IF NOT EXISTS "onboardingStage" "TenantOnboardingStage" NOT NULL DEFAULT 'SUBMITTED',
  ADD COLUMN IF NOT EXISTS "selectedTierCode" TEXT,
  ADD COLUMN IF NOT EXISTS "selectedPricingVersion" INTEGER,
  ADD COLUMN IF NOT EXISTS "selectedBillingCycle" TEXT,
  ADD COLUMN IF NOT EXISTS "pricingSnapshot" JSONB,
  ADD COLUMN IF NOT EXISTS "tierConfirmedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "paymentIntentId" TEXT,
  ADD COLUMN IF NOT EXISTS "paymentStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "paymentSettledAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "enterpriseQuoteStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "enterpriseQuoteReference" TEXT,
  ADD COLUMN IF NOT EXISTS "enterpriseContractSignedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "provisionedOrganizationId" TEXT,
  ADD COLUMN IF NOT EXISTS "provisionedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reviewerCanonicalRoleKey" "CanonicalRoleKey",
  ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "rejectedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "activatedBy" TEXT;

ALTER TABLE "tenant_applications"
  ALTER COLUMN "businessRegistrationNumber" DROP NOT NULL,
  ALTER COLUMN "yearsInEVBusiness" DROP NOT NULL,
  ALTER COLUMN "siteId" DROP NOT NULL,
  ALTER COLUMN "preferredLeaseModel" DROP NOT NULL,
  ALTER COLUMN "businessPlanSummary" DROP NOT NULL;

ALTER TABLE "tenant_applications"
  DROP CONSTRAINT IF EXISTS "tenant_applications_siteId_fkey";

ALTER TABLE "tenant_applications"
  ADD CONSTRAINT "tenant_applications_siteId_fkey"
  FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "tenant_applications"
  DROP CONSTRAINT IF EXISTS "tenant_applications_provisionedOrganizationId_fkey";

ALTER TABLE "tenant_applications"
  ADD CONSTRAINT "tenant_applications_provisionedOrganizationId_fkey"
  FOREIGN KEY ("provisionedOrganizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "tenant_applications_applicant_stage_idx"
  ON "tenant_applications"("applicantId", "onboardingStage");

CREATE INDEX IF NOT EXISTS "tenant_applications_stage_updated_idx"
  ON "tenant_applications"("onboardingStage", "updatedAt");

CREATE INDEX IF NOT EXISTS "tenant_applications_provisioned_org_idx"
  ON "tenant_applications"("provisionedOrganizationId");

CREATE INDEX IF NOT EXISTS "tenant_applications_selected_tier_stage_idx"
  ON "tenant_applications"("selectedTierCode", "onboardingStage");

CREATE INDEX IF NOT EXISTS "tenant_applications_confirmed_subdomain_idx"
  ON "tenant_applications"("confirmedSubdomain");

CREATE INDEX IF NOT EXISTS "tenant_applications_confirmed_domain_idx"
  ON "tenant_applications"("confirmedDomain");

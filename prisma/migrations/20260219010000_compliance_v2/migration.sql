ALTER TABLE "swap_providers"
  ADD COLUMN "complianceMarkets" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "complianceProfile" JSONB;

ALTER TABLE "provider_relationships"
  ADD COLUMN "complianceMarkets" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "complianceProfile" JSONB;

ALTER TABLE "provider_documents"
  ADD COLUMN "cloudinaryPublicId" TEXT;

CREATE TABLE "compliance_policies" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "data" JSONB NOT NULL,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "compliance_policies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "compliance_policies_code_key" ON "compliance_policies"("code");

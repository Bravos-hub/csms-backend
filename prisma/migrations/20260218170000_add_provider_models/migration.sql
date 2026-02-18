-- Extend user roles for provider portal users
ALTER TYPE "UserRole" ADD VALUE 'SWAP_PROVIDER_ADMIN';
ALTER TYPE "UserRole" ADD VALUE 'SWAP_PROVIDER_OPERATOR';

-- Create provider enums
CREATE TYPE "SwapProviderStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED');
CREATE TYPE "ProviderRelationshipStatus" AS ENUM ('REQUESTED', 'PROVIDER_ACCEPTED', 'DOCS_PENDING', 'ADMIN_APPROVED', 'ACTIVE', 'SUSPENDED', 'TERMINATED');
CREATE TYPE "ProviderDocumentType" AS ENUM ('INCORPORATION', 'TAX_COMPLIANCE', 'INSURANCE', 'BATTERY_SAFETY_CERTIFICATION', 'RECYCLING_COMPLIANCE', 'TECHNICAL_CONFORMANCE', 'COMMERCIAL_AGREEMENT', 'SOP_ACKNOWLEDGEMENT', 'SITE_COMPATIBILITY_DECLARATION');
CREATE TYPE "ProviderDocumentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "ProviderSettlementStatus" AS ENUM ('PENDING', 'PAID', 'DISPUTED');

-- Add provider scope to users
ALTER TABLE "users" ADD COLUMN "providerId" TEXT;

-- Create providers
CREATE TABLE "swap_providers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logoUrl" TEXT,
    "legalName" TEXT,
    "registrationNumber" TEXT,
    "taxId" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "region" TEXT NOT NULL,
    "regions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "countries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "organizationId" TEXT,
    "standard" TEXT NOT NULL DEFAULT 'Universal',
    "batteriesSupported" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "supportedStationTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "protocolCapabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "feeModel" TEXT,
    "settlementTerms" TEXT,
    "stationCount" INTEGER NOT NULL DEFAULT 0,
    "website" TEXT,
    "status" "SwapProviderStatus" NOT NULL DEFAULT 'DRAFT',
    "statusReason" TEXT,
    "approvedAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "requiredDocuments" "ProviderDocumentType"[] DEFAULT ARRAY[]::"ProviderDocumentType"[],
    "partnerSince" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "swap_providers_pkey" PRIMARY KEY ("id")
);

-- Create owner/provider relationships
CREATE TABLE "provider_relationships" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "ownerOrgId" TEXT NOT NULL,
    "status" "ProviderRelationshipStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedBy" TEXT,
    "providerRespondedAt" TIMESTAMP(3),
    "adminApprovedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "provider_relationships_pkey" PRIMARY KEY ("id")
);

-- Create provider documents
CREATE TABLE "provider_documents" (
    "id" TEXT NOT NULL,
    "providerId" TEXT,
    "relationshipId" TEXT,
    "ownerOrgId" TEXT,
    "type" "ProviderDocumentType" NOT NULL,
    "name" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedBy" TEXT,
    "status" "ProviderDocumentStatus" NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    CONSTRAINT "provider_documents_pkey" PRIMARY KEY ("id")
);

-- Create provider settlement ledger
CREATE TABLE "provider_settlement_entries" (
    "id" TEXT NOT NULL,
    "relationshipId" TEXT,
    "providerId" TEXT NOT NULL,
    "ownerOrgId" TEXT,
    "stationId" TEXT,
    "sessionId" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "providerFee" DOUBLE PRECISION NOT NULL,
    "platformFee" DOUBLE PRECISION NOT NULL,
    "adjustment" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "net" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "ProviderSettlementStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "provider_settlement_entries_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "users_providerId_idx" ON "users"("providerId");
CREATE INDEX "swap_providers_status_idx" ON "swap_providers"("status");
CREATE INDEX "swap_providers_region_idx" ON "swap_providers"("region");
CREATE INDEX "swap_providers_organizationId_idx" ON "swap_providers"("organizationId");
CREATE INDEX "provider_relationships_providerId_idx" ON "provider_relationships"("providerId");
CREATE INDEX "provider_relationships_ownerOrgId_idx" ON "provider_relationships"("ownerOrgId");
CREATE INDEX "provider_relationships_status_idx" ON "provider_relationships"("status");
CREATE INDEX "provider_documents_providerId_idx" ON "provider_documents"("providerId");
CREATE INDEX "provider_documents_relationshipId_idx" ON "provider_documents"("relationshipId");
CREATE INDEX "provider_documents_status_idx" ON "provider_documents"("status");
CREATE INDEX "provider_settlement_entries_providerId_idx" ON "provider_settlement_entries"("providerId");
CREATE INDEX "provider_settlement_entries_ownerOrgId_idx" ON "provider_settlement_entries"("ownerOrgId");
CREATE INDEX "provider_settlement_entries_createdAt_idx" ON "provider_settlement_entries"("createdAt");
CREATE INDEX "provider_settlement_entries_status_idx" ON "provider_settlement_entries"("status");

-- Foreign keys
ALTER TABLE "users"
    ADD CONSTRAINT "users_providerId_fkey"
    FOREIGN KEY ("providerId") REFERENCES "swap_providers"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "swap_providers"
    ADD CONSTRAINT "swap_providers_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "provider_relationships"
    ADD CONSTRAINT "provider_relationships_providerId_fkey"
    FOREIGN KEY ("providerId") REFERENCES "swap_providers"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "provider_relationships"
    ADD CONSTRAINT "provider_relationships_ownerOrgId_fkey"
    FOREIGN KEY ("ownerOrgId") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "provider_documents"
    ADD CONSTRAINT "provider_documents_providerId_fkey"
    FOREIGN KEY ("providerId") REFERENCES "swap_providers"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "provider_documents"
    ADD CONSTRAINT "provider_documents_relationshipId_fkey"
    FOREIGN KEY ("relationshipId") REFERENCES "provider_relationships"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "provider_settlement_entries"
    ADD CONSTRAINT "provider_settlement_entries_providerId_fkey"
    FOREIGN KEY ("providerId") REFERENCES "swap_providers"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "provider_settlement_entries"
    ADD CONSTRAINT "provider_settlement_entries_relationshipId_fkey"
    FOREIGN KEY ("relationshipId") REFERENCES "provider_relationships"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

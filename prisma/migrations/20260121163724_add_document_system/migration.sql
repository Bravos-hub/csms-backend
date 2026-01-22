-- CreateEnum
CREATE TYPE "DocumentCategory" AS ENUM ('OWNERSHIP_PROOF', 'OWNER_IDENTITY', 'OWNER_ADDRESS_PROOF', 'SITE_PHOTOS', 'ELECTRICAL_CAPACITY', 'SITE_PLAN', 'LAND_USE_PERMIT', 'SOCIETY_NOC', 'LENDER_CONSENT', 'CO_OWNER_CONSENT', 'BUSINESS_REGISTRATION', 'OPERATOR_IDENTITY', 'OPERATOR_ADDRESS_PROOF', 'OPERATOR_PHOTO', 'OPERATOR_BUSINESS_REG', 'TAX_CERTIFICATE', 'BANK_STATEMENTS', 'INSTALLATION_LICENSE', 'INSURANCE_CERTIFICATE', 'PORTFOLIO', 'INSTALLATION_PLAN', 'EQUIPMENT_SPECS', 'LEASE_AGREEMENT', 'LEASE_REGISTRATION', 'STAMP_DUTY_RECEIPT', 'SECURITY_DEPOSIT_RECEIPT', 'INDEMNITY_BOND', 'EXECUTED_LEASE', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED', 'INFO_REQUESTED');

-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('SITE', 'APPLICATION', 'TENANT', 'USER');

-- AlterTable
ALTER TABLE "sites" ADD COLUMN     "documentsVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "documentsVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "documentsVerifiedBy" TEXT,
ADD COLUMN     "verificationStatus" TEXT NOT NULL DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "category" "DocumentCategory" NOT NULL,
    "entityType" "EntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "cloudinaryPublicId" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "verifiedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "expiryDate" TIMESTAMP(3),
    "expiryReminder" BOOLEAN NOT NULL DEFAULT false,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "allowMultiple" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "documents_entityType_entityId_idx" ON "documents"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "documents_status_idx" ON "documents"("status");

-- CreateIndex
CREATE INDEX "documents_category_idx" ON "documents"("category");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploadedBy_fkey" FOREIGN KEY ("uploadedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_verifiedBy_fkey" FOREIGN KEY ("verifiedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

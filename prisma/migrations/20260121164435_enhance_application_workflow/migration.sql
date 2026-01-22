/*
  Warnings:

  - The `status` column on the `tenant_applications` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'INFO_REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'NEGOTIATING', 'TERMS_AGREED', 'AWAITING_DEPOSIT', 'DEPOSIT_PAID', 'LEASE_DRAFTING', 'LEASE_PENDING_SIGNATURE', 'LEASE_SIGNED', 'COMPLIANCE_CHECK', 'COMPLETED', 'WITHDRAWN', 'CANCELLED', 'EXPIRED');

-- AlterTable
ALTER TABLE "tenant_applications" ADD COLUMN     "approvalNotes" TEXT,
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "depositPaidAt" TIMESTAMP(3),
ADD COLUMN     "depositReceiptUrl" TEXT,
ADD COLUMN     "leaseAgreementUrl" TEXT,
ADD COLUMN     "leaseEndDate" TIMESTAMP(3),
ADD COLUMN     "leaseSignedAt" TIMESTAMP(3),
ADD COLUMN     "leaseStartDate" TIMESTAMP(3),
ADD COLUMN     "negotiatedTerms" JSONB,
ADD COLUMN     "paymentId" TEXT,
ADD COLUMN     "proposedTerms" JSONB,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedBy" TEXT,
ADD COLUMN     "securityDepositAmount" DECIMAL(65,30),
ADD COLUMN     "tenantId" TEXT,
ADD COLUMN     "termsAgreedAt" TIMESTAMP(3),
DROP COLUMN "status",
ADD COLUMN     "status" "ApplicationStatus" NOT NULL DEFAULT 'DRAFT';

-- AddForeignKey
ALTER TABLE "tenant_applications" ADD CONSTRAINT "tenant_applications_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_applications" ADD CONSTRAINT "tenant_applications_reviewedBy_fkey" FOREIGN KEY ("reviewedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

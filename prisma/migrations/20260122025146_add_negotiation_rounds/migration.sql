/*
  Warnings:

  - You are about to drop the column `tenantId` on the `tenant_applications` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "tenant_applications" DROP COLUMN "tenantId";

-- CreateTable
CREATE TABLE "negotiation_rounds" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "proposedBy" TEXT NOT NULL,
    "terms" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "respondedBy" TEXT,
    "respondedAt" TIMESTAMP(3),
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "negotiation_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "negotiation_rounds_applicationId_idx" ON "negotiation_rounds"("applicationId");

-- AddForeignKey
ALTER TABLE "negotiation_rounds" ADD CONSTRAINT "negotiation_rounds_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "tenant_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "negotiation_rounds" ADD CONSTRAINT "negotiation_rounds_proposedBy_fkey" FOREIGN KEY ("proposedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "negotiation_rounds" ADD CONSTRAINT "negotiation_rounds_respondedBy_fkey" FOREIGN KEY ("respondedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

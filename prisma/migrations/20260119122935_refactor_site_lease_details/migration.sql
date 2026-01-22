/*
  Warnings:

  - You are about to drop the column `expectedFootfall` on the `sites` table. All the data in the column will be lost.
  - You are about to drop the column `expectedMonthlyPrice` on the `sites` table. All the data in the column will be lost.
  - You are about to drop the column `leaseType` on the `sites` table. All the data in the column will be lost.
  - You are about to drop the column `status` on the `sites` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "SitePurpose" AS ENUM ('PERSONAL', 'COMMERCIAL');

-- CreateEnum
CREATE TYPE "LeaseType" AS ENUM ('REVENUE_SHARE', 'FIXED_RENT', 'HYBRID');

-- CreateEnum
CREATE TYPE "Footfall" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH');

-- AlterTable
ALTER TABLE "sites" DROP COLUMN "expectedFootfall",
DROP COLUMN "expectedMonthlyPrice",
DROP COLUMN "leaseType",
DROP COLUMN "status",
ADD COLUMN     "purpose" "SitePurpose" NOT NULL DEFAULT 'COMMERCIAL';

-- CreateTable
CREATE TABLE "site_lease_details" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "leaseType" "LeaseType" NOT NULL,
    "expectedMonthlyPrice" DOUBLE PRECISION,
    "expectedFootfall" "Footfall" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_lease_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "siteId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "site_lease_details_siteId_key" ON "site_lease_details"("siteId");

-- AddForeignKey
ALTER TABLE "site_lease_details" ADD CONSTRAINT "site_lease_details_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

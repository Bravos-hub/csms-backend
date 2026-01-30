-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "UserRole" ADD VALUE 'EVZONE_ADMIN';
ALTER TYPE "UserRole" ADD VALUE 'EVZONE_OPERATOR';
ALTER TYPE "UserRole" ADD VALUE 'OWNER';
ALTER TYPE "UserRole" ADD VALUE 'STATION_ADMIN';
ALTER TYPE "UserRole" ADD VALUE 'MANAGER';
ALTER TYPE "UserRole" ADD VALUE 'ATTENDANT';
ALTER TYPE "UserRole" ADD VALUE 'CASHIER';
ALTER TYPE "UserRole" ADD VALUE 'TECHNICIAN_ORG';
ALTER TYPE "UserRole" ADD VALUE 'TECHNICIAN_PUBLIC';

-- AlterTable
ALTER TABLE "sites" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "country" TEXT,
ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "region" TEXT,
ADD COLUMN     "subscribedPackage" TEXT;

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "logoUrl" TEXT,
    "type" TEXT NOT NULL DEFAULT 'COMPANY',
    "paymentProvider" TEXT,
    "walletNumber" TEXT,
    "taxId" TEXT,
    "regId" TEXT,
    "address" TEXT,
    "city" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "ocpi_partner_locations_country_code_party_id_location_id_versio" RENAME TO "ocpi_partner_locations_country_code_party_id_location_id_ve_key";

-- RenameIndex
ALTER INDEX "ocpi_partner_sessions_country_code_party_id_session_id_version_" RENAME TO "ocpi_partner_sessions_country_code_party_id_session_id_vers_key";

-- RenameIndex
ALTER INDEX "ocpi_partner_tariffs_country_code_party_id_tariff_id_version_ke" RENAME TO "ocpi_partner_tariffs_country_code_party_id_tariff_id_versio_key";

-- RenameIndex
ALTER INDEX "ocpi_partner_tokens_country_code_party_id_token_uid_token_type_" RENAME TO "ocpi_partner_tokens_country_code_party_id_token_uid_token_t_key";

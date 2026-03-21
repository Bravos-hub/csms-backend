-- CreateEnum
CREATE TYPE "PowertrainType" AS ENUM ('BEV', 'PHEV', 'HEV', 'ICE');

-- CreateEnum
CREATE TYPE "ConnectorType" AS ENUM ('TYPE_1', 'TYPE_2', 'CCS1', 'CCS2', 'CHADEMO', 'GBT_AC', 'GBT_DC', 'TESLA_NACS', 'TESLA_SCS');

-- AlterTable
ALTER TABLE "charge_points" ADD COLUMN     "power" DOUBLE PRECISION NOT NULL DEFAULT 50.0,
ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'CCS2';

-- AlterTable
ALTER TABLE "compliance_policies" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "twoFactorSecret" TEXT;

-- CreateTable
CREATE TABLE "ChargePointStatusHistory" (
    "id" TEXT NOT NULL,
    "chargePointId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChargePointStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "vehicleName" TEXT NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "yearOfManufacture" INTEGER NOT NULL,
    "countryOfRegistration" TEXT,
    "powertrain" "PowertrainType" NOT NULL,
    "vin" TEXT,
    "licensePlate" TEXT NOT NULL,
    "photoUrl" TEXT,
    "cloudinaryPublicId" TEXT,
    "bodyType" TEXT,
    "color" TEXT,
    "batteryKwh" DOUBLE PRECISION,
    "acMaxKw" DOUBLE PRECISION,
    "dcMaxKw" DOUBLE PRECISION,
    "connectors" "ConnectorType"[],
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChargePointStatusHistory_chargePointId_timestamp_idx" ON "ChargePointStatusHistory"("chargePointId", "timestamp");

-- CreateIndex
CREATE INDEX "vehicles_userId_idx" ON "vehicles"("userId");

-- CreateIndex
CREATE INDEX "vehicles_userId_isActive_idx" ON "vehicles"("userId", "isActive");

-- CreateIndex
CREATE INDEX "vehicles_licensePlate_idx" ON "vehicles"("licensePlate");

-- CreateIndex
CREATE INDEX "geographic_zones_isActive_idx" ON "geographic_zones"("isActive");

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargePointStatusHistory" ADD CONSTRAINT "ChargePointStatusHistory_chargePointId_fkey" FOREIGN KEY ("chargePointId") REFERENCES "charge_points"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "marketplace_contact_events_actorId_entityKind_entityId_createdA" RENAME TO "marketplace_contact_events_actorId_entityKind_entityId_crea_idx";

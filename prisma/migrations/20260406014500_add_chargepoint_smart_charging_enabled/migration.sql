-- AlterTable
ALTER TABLE "charge_points"
ADD COLUMN IF NOT EXISTS "smartChargingEnabled" BOOLEAN NOT NULL DEFAULT false;

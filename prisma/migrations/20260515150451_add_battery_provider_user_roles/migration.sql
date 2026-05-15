/*
  Warnings:

  - You are about to drop the `battery_cabinet_slots` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `battery_cabinets` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `battery_packs` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `battery_provider_alerts` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `battery_provider_assignments` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `battery_provider_sla_snapshots` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `battery_provider_user_scopes` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `battery_telemetry` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `mqtt_device_registries` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `mqtt_vendor_payload_logs` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `swap_sessions` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "UserRole" ADD VALUE 'BATTERY_PROVIDER_ADMIN';
ALTER TYPE "UserRole" ADD VALUE 'BATTERY_PROVIDER_MANAGER';
ALTER TYPE "UserRole" ADD VALUE 'BATTERY_PROVIDER_TECHNICIAN';
ALTER TYPE "UserRole" ADD VALUE 'BATTERY_PROVIDER_VIEWER';

-- DropForeignKey
ALTER TABLE "battery_cabinet_slots" DROP CONSTRAINT "battery_cabinet_slots_cabinetId_fkey";

-- DropForeignKey
ALTER TABLE "battery_cabinet_slots" DROP CONSTRAINT "battery_cabinet_slots_packId_fkey";

-- DropForeignKey
ALTER TABLE "battery_telemetry" DROP CONSTRAINT "battery_telemetry_packId_fkey";

-- DropForeignKey
ALTER TABLE "mqtt_device_registries" DROP CONSTRAINT "mqtt_device_registries_siteId_fkey";

-- DropTable
DROP TABLE "battery_cabinet_slots";

-- DropTable
DROP TABLE "battery_cabinets";

-- DropTable
DROP TABLE "battery_packs";

-- DropTable
DROP TABLE "battery_provider_alerts";

-- DropTable
DROP TABLE "battery_provider_assignments";

-- DropTable
DROP TABLE "battery_provider_sla_snapshots";

-- DropTable
DROP TABLE "battery_provider_user_scopes";

-- DropTable
DROP TABLE "battery_telemetry";

-- DropTable
DROP TABLE "mqtt_device_registries";

-- DropTable
DROP TABLE "mqtt_vendor_payload_logs";

-- DropTable
DROP TABLE "swap_sessions";

-- DropEnum
DROP TYPE "BatteryCabinetStatus";

-- DropEnum
DROP TYPE "BatteryPackStatus";

-- DropEnum
DROP TYPE "BatteryProviderAlertCategory";

-- DropEnum
DROP TYPE "BatteryProviderAlertSeverity";

-- DropEnum
DROP TYPE "BatteryProviderAlertStatus";

-- DropEnum
DROP TYPE "BatteryProviderAssignmentStatus";

-- DropEnum
DROP TYPE "BatteryProviderUserRole";

-- DropEnum
DROP TYPE "SwapSessionStage";

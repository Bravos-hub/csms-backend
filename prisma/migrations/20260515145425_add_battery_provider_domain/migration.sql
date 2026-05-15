-- CreateEnum
CREATE TYPE "BatteryPackStatus" AS ENUM ('READY', 'CHARGING', 'RESERVED', 'IN_SWAP', 'IN_TRANSIT', 'DEGRADED', 'FAULTED', 'LOCKED', 'QUARANTINED', 'MAINTENANCE', 'RETIRED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SwapSessionStage" AS ENUM ('INITIATED', 'DOCKING', 'DISCONNECTING_OLD', 'RECONNECTING_NEW', 'UNDOCKING', 'COMPLETE', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BatteryCabinetStatus" AS ENUM ('ONLINE', 'OFFLINE', 'DEGRADED', 'MAINTENANCE', 'FAULTED');

-- CreateEnum
CREATE TYPE "BatteryProviderAssignmentStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'PENDING', 'TERMINATED');

-- CreateEnum
CREATE TYPE "BatteryProviderUserRole" AS ENUM ('ADMIN', 'MANAGER', 'TECHNICIAN', 'VIEWER');

-- CreateEnum
CREATE TYPE "BatteryProviderAlertCategory" AS ENUM ('BATTERY_SAFETY', 'CABINET_FAULT', 'BMS_OFFLINE', 'STALE_TELEMETRY', 'PACK_DEGRADATION', 'SWAP_FAILURE', 'TAMPER', 'MAINTENANCE_OVERDUE', 'SLA_BREACH');

-- CreateEnum
CREATE TYPE "BatteryProviderAlertSeverity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "BatteryProviderAlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'ASSIGNED', 'RESOLVED', 'ESCALATED');

-- CreateTable
CREATE TABLE "battery_packs" (
    "id" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "status" "BatteryPackStatus" NOT NULL DEFAULT 'READY',
    "bmsType" TEXT NOT NULL DEFAULT 'UNKNOWN_3RD_PARTY',
    "capacityAh" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "soc" DOUBLE PRECISION,
    "soh" DOUBLE PRECISION,
    "voltage" DOUBLE PRECISION,
    "current" DOUBLE PRECISION,
    "temperature" DOUBLE PRECISION,
    "cycleCount" INTEGER NOT NULL DEFAULT 0,
    "healthScore" DOUBLE PRECISION,
    "firmwareVersion" TEXT,
    "providerId" TEXT,
    "stationId" TEXT,
    "cabinetId" TEXT,
    "slotId" TEXT,
    "orgId" TEXT,
    "tenantId" TEXT,
    "lastTelemetryAt" TIMESTAMP(3),
    "quarantinedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "battery_packs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "battery_telemetry" (
    "id" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MQTT_BMS',
    "voltage" DOUBLE PRECISION,
    "current" DOUBLE PRECISION,
    "soc" DOUBLE PRECISION,
    "soh" DOUBLE PRECISION,
    "temps" DOUBLE PRECISION[] DEFAULT ARRAY[]::DOUBLE PRECISION[],
    "cells" DOUBLE PRECISION[] DEFAULT ARRAY[]::DOUBLE PRECISION[],
    "cellVoltages" JSONB,
    "alerts" JSONB,
    "rawPayload" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "battery_telemetry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "battery_cabinets" (
    "id" TEXT NOT NULL,
    "cabinetId" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orgId" TEXT,
    "status" "BatteryCabinetStatus" NOT NULL DEFAULT 'ONLINE',
    "isOnline" BOOLEAN NOT NULL DEFAULT true,
    "powerState" TEXT NOT NULL DEFAULT 'OK',
    "doorLocked" BOOLEAN NOT NULL DEFAULT true,
    "robotHealth" TEXT NOT NULL DEFAULT 'OK',
    "totalSlots" INTEGER NOT NULL DEFAULT 0,
    "occupiedSlots" INTEGER NOT NULL DEFAULT 0,
    "faultCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastHeartbeatAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "battery_cabinets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "battery_cabinet_slots" (
    "id" TEXT NOT NULL,
    "cabinetId" TEXT NOT NULL,
    "slotNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'EMPTY',
    "packId" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "faultReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "battery_cabinet_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "swap_sessions" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "cabinetId" TEXT,
    "providerId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orgId" TEXT,
    "vehicleId" TEXT,
    "riderId" TEXT,
    "inboundPackId" TEXT,
    "outboundPackId" TEXT,
    "stage" "SwapSessionStage" NOT NULL DEFAULT 'INITIATED',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "durationSec" INTEGER,
    "failureReason" TEXT,
    "attendantId" TEXT,
    "paymentStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "swap_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mqtt_device_registries" (
    "id" TEXT NOT NULL,
    "vendorDeviceId" TEXT NOT NULL,
    "integrationType" TEXT,
    "deviceType" TEXT,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT,
    "stationId" TEXT,
    "providerId" TEXT,
    "vendorProviderId" TEXT,
    "capabilities" JSONB,
    "metadata" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mqtt_device_registries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mqtt_vendor_payload_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vendorDeviceId" TEXT,
    "deviceRegistryId" TEXT,
    "topic" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "normalizedEventType" TEXT,
    "errorMessage" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mqtt_vendor_payload_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "battery_provider_assignments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "assignedStationIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "assignedCabinetIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "BatteryProviderAssignmentStatus" NOT NULL DEFAULT 'PENDING',
    "contractType" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "battery_provider_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "battery_provider_user_scopes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "role" "BatteryProviderUserRole" NOT NULL DEFAULT 'VIEWER',
    "assignedStationIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "assignedCabinetIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "battery_provider_user_scopes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "battery_provider_sla_snapshots" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "providerUptimePct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cabinetUptimePct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "telemetryFreshnessPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "packAvailabilityPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "failedSwapRatePct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgResolutionMinutes" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "slaBreaches" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "battery_provider_sla_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "battery_provider_alerts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "category" "BatteryProviderAlertCategory" NOT NULL,
    "severity" "BatteryProviderAlertSeverity" NOT NULL,
    "status" "BatteryProviderAlertStatus" NOT NULL DEFAULT 'OPEN',
    "assetType" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedToUserId" TEXT,
    "acknowledgedBy" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "escalatedToOrgId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "battery_provider_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "battery_packs_serialNumber_key" ON "battery_packs"("serialNumber");

-- CreateIndex
CREATE INDEX "battery_packs_serialNumber_idx" ON "battery_packs"("serialNumber");

-- CreateIndex
CREATE INDEX "battery_packs_status_idx" ON "battery_packs"("status");

-- CreateIndex
CREATE INDEX "battery_packs_providerId_idx" ON "battery_packs"("providerId");

-- CreateIndex
CREATE INDEX "battery_packs_stationId_idx" ON "battery_packs"("stationId");

-- CreateIndex
CREATE INDEX "battery_packs_orgId_idx" ON "battery_packs"("orgId");

-- CreateIndex
CREATE INDEX "battery_packs_tenantId_idx" ON "battery_packs"("tenantId");

-- CreateIndex
CREATE INDEX "battery_telemetry_packId_idx" ON "battery_telemetry"("packId");

-- CreateIndex
CREATE INDEX "battery_telemetry_timestamp_idx" ON "battery_telemetry"("timestamp");

-- CreateIndex
CREATE INDEX "battery_telemetry_source_idx" ON "battery_telemetry"("source");

-- CreateIndex
CREATE INDEX "battery_cabinets_cabinetId_idx" ON "battery_cabinets"("cabinetId");

-- CreateIndex
CREATE INDEX "battery_cabinets_stationId_idx" ON "battery_cabinets"("stationId");

-- CreateIndex
CREATE INDEX "battery_cabinets_providerId_idx" ON "battery_cabinets"("providerId");

-- CreateIndex
CREATE INDEX "battery_cabinets_tenantId_idx" ON "battery_cabinets"("tenantId");

-- CreateIndex
CREATE INDEX "battery_cabinets_status_idx" ON "battery_cabinets"("status");

-- CreateIndex
CREATE UNIQUE INDEX "battery_cabinet_slots_packId_key" ON "battery_cabinet_slots"("packId");

-- CreateIndex
CREATE INDEX "battery_cabinet_slots_cabinetId_idx" ON "battery_cabinet_slots"("cabinetId");

-- CreateIndex
CREATE INDEX "battery_cabinet_slots_packId_idx" ON "battery_cabinet_slots"("packId");

-- CreateIndex
CREATE UNIQUE INDEX "battery_cabinet_slots_cabinetId_slotNumber_key" ON "battery_cabinet_slots"("cabinetId", "slotNumber");

-- CreateIndex
CREATE INDEX "swap_sessions_sessionId_idx" ON "swap_sessions"("sessionId");

-- CreateIndex
CREATE INDEX "swap_sessions_stationId_idx" ON "swap_sessions"("stationId");

-- CreateIndex
CREATE INDEX "swap_sessions_providerId_idx" ON "swap_sessions"("providerId");

-- CreateIndex
CREATE INDEX "swap_sessions_tenantId_idx" ON "swap_sessions"("tenantId");

-- CreateIndex
CREATE INDEX "swap_sessions_stage_idx" ON "swap_sessions"("stage");

-- CreateIndex
CREATE INDEX "swap_sessions_startedAt_idx" ON "swap_sessions"("startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "mqtt_device_registries_vendorDeviceId_key" ON "mqtt_device_registries"("vendorDeviceId");

-- CreateIndex
CREATE INDEX "mqtt_device_registries_vendorDeviceId_idx" ON "mqtt_device_registries"("vendorDeviceId");

-- CreateIndex
CREATE INDEX "mqtt_device_registries_siteId_idx" ON "mqtt_device_registries"("siteId");

-- CreateIndex
CREATE INDEX "mqtt_device_registries_stationId_idx" ON "mqtt_device_registries"("stationId");

-- CreateIndex
CREATE INDEX "mqtt_device_registries_tenantId_idx" ON "mqtt_device_registries"("tenantId");

-- CreateIndex
CREATE INDEX "mqtt_device_registries_isActive_idx" ON "mqtt_device_registries"("isActive");

-- CreateIndex
CREATE INDEX "mqtt_vendor_payload_logs_tenantId_idx" ON "mqtt_vendor_payload_logs"("tenantId");

-- CreateIndex
CREATE INDEX "mqtt_vendor_payload_logs_vendorDeviceId_idx" ON "mqtt_vendor_payload_logs"("vendorDeviceId");

-- CreateIndex
CREATE INDEX "mqtt_vendor_payload_logs_normalizedEventType_idx" ON "mqtt_vendor_payload_logs"("normalizedEventType");

-- CreateIndex
CREATE INDEX "mqtt_vendor_payload_logs_createdAt_idx" ON "mqtt_vendor_payload_logs"("createdAt");

-- CreateIndex
CREATE INDEX "battery_provider_assignments_tenantId_idx" ON "battery_provider_assignments"("tenantId");

-- CreateIndex
CREATE INDEX "battery_provider_assignments_providerId_idx" ON "battery_provider_assignments"("providerId");

-- CreateIndex
CREATE INDEX "battery_provider_assignments_status_idx" ON "battery_provider_assignments"("status");

-- CreateIndex
CREATE INDEX "battery_provider_user_scopes_userId_idx" ON "battery_provider_user_scopes"("userId");

-- CreateIndex
CREATE INDEX "battery_provider_user_scopes_tenantId_idx" ON "battery_provider_user_scopes"("tenantId");

-- CreateIndex
CREATE INDEX "battery_provider_user_scopes_providerId_idx" ON "battery_provider_user_scopes"("providerId");

-- CreateIndex
CREATE UNIQUE INDEX "battery_provider_user_scopes_userId_tenantId_providerId_key" ON "battery_provider_user_scopes"("userId", "tenantId", "providerId");

-- CreateIndex
CREATE INDEX "battery_provider_sla_snapshots_tenantId_providerId_idx" ON "battery_provider_sla_snapshots"("tenantId", "providerId");

-- CreateIndex
CREATE INDEX "battery_provider_sla_snapshots_periodStart_periodEnd_idx" ON "battery_provider_sla_snapshots"("periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "battery_provider_alerts_tenantId_providerId_idx" ON "battery_provider_alerts"("tenantId", "providerId");

-- CreateIndex
CREATE INDEX "battery_provider_alerts_status_idx" ON "battery_provider_alerts"("status");

-- CreateIndex
CREATE INDEX "battery_provider_alerts_severity_idx" ON "battery_provider_alerts"("severity");

-- CreateIndex
CREATE INDEX "battery_provider_alerts_category_idx" ON "battery_provider_alerts"("category");

-- CreateIndex
CREATE INDEX "battery_provider_alerts_assetId_idx" ON "battery_provider_alerts"("assetId");

-- CreateIndex
CREATE INDEX "battery_provider_alerts_createdAt_idx" ON "battery_provider_alerts"("createdAt");

-- AddForeignKey
ALTER TABLE "battery_telemetry" ADD CONSTRAINT "battery_telemetry_packId_fkey" FOREIGN KEY ("packId") REFERENCES "battery_packs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "battery_cabinet_slots" ADD CONSTRAINT "battery_cabinet_slots_cabinetId_fkey" FOREIGN KEY ("cabinetId") REFERENCES "battery_cabinets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "battery_cabinet_slots" ADD CONSTRAINT "battery_cabinet_slots_packId_fkey" FOREIGN KEY ("packId") REFERENCES "battery_packs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mqtt_device_registries" ADD CONSTRAINT "mqtt_device_registries_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

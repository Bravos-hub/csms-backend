DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'VehicleOwnershipType') THEN
    CREATE TYPE "VehicleOwnershipType" AS ENUM ('PERSONAL', 'ORGANIZATION', 'FLEET');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'VehicleStatusType') THEN
    CREATE TYPE "VehicleStatusType" AS ENUM ('ACTIVE', 'INACTIVE', 'MAINTENANCE', 'RETIRED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TelemetryProviderType') THEN
    CREATE TYPE "TelemetryProviderType" AS ENUM (
      'SMARTCAR',
      'ENODE',
      'AUTOPI',
      'OPENDBC',
      'MQTT_BMS',
      'OBD_DONGLE',
      'OEM_API',
      'MANUAL_IMPORT',
      'MOCK'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'VehicleTelemetryCapability') THEN
    CREATE TYPE "VehicleTelemetryCapability" AS ENUM ('READ', 'COMMANDS');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'VehicleTelemetryHealth') THEN
    CREATE TYPE "VehicleTelemetryHealth" AS ENUM ('HEALTHY', 'DEGRADED', 'OFFLINE', 'UNKNOWN');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'VehicleFaultLifecycleStatus') THEN
    CREATE TYPE "VehicleFaultLifecycleStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'VehicleFaultSeverity') THEN
    CREATE TYPE "VehicleFaultSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WebhookDeliveryStatus') THEN
    CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'DEAD_LETTER');
  END IF;
END $$;

ALTER TABLE "vehicles"
  ADD COLUMN IF NOT EXISTS "ownership_type" "VehicleOwnershipType",
  ADD COLUMN IF NOT EXISTS "organization_id" TEXT,
  ADD COLUMN IF NOT EXISTS "fleet_account_id" TEXT,
  ADD COLUMN IF NOT EXISTS "fleet_driver_id" TEXT,
  ADD COLUMN IF NOT EXISTS "fleet_driver_group_id" TEXT,
  ADD COLUMN IF NOT EXISTS "depot_site_id" TEXT,
  ADD COLUMN IF NOT EXISTS "operating_region" TEXT,
  ADD COLUMN IF NOT EXISTS "vehicle_status" "VehicleStatusType" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS "vehicle_role" TEXT,
  ADD COLUMN IF NOT EXISTS "telemetry_provider" "TelemetryProviderType" NOT NULL DEFAULT 'MOCK';

ALTER TABLE "commands"
  ADD COLUMN IF NOT EXISTS "domain" TEXT NOT NULL DEFAULT 'CHARGE_POINT',
  ADD COLUMN IF NOT EXISTS "vehicle_id" TEXT,
  ADD COLUMN IF NOT EXISTS "provider" TEXT,
  ADD COLUMN IF NOT EXISTS "provider_vehicle_id" TEXT,
  ADD COLUMN IF NOT EXISTS "provider_command_id" TEXT,
  ADD COLUMN IF NOT EXISTS "result_code" TEXT;

ALTER TABLE "webhooks"
  ADD COLUMN IF NOT EXISTS "organization_id" TEXT,
  ADD COLUMN IF NOT EXISTS "timeout_ms" INTEGER NOT NULL DEFAULT 5000,
  ADD COLUMN IF NOT EXISTS "max_retries" INTEGER NOT NULL DEFAULT 3;

CREATE TABLE IF NOT EXISTS "vehicle_telemetry_sources" (
  "id" TEXT NOT NULL,
  "vehicle_id" TEXT NOT NULL,
  "provider" "TelemetryProviderType" NOT NULL,
  "provider_vehicle_id" TEXT,
  "capabilities" "VehicleTelemetryCapability"[] NOT NULL DEFAULT ARRAY[]::"VehicleTelemetryCapability"[],
  "credential_ref" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "health" "VehicleTelemetryHealth" NOT NULL DEFAULT 'UNKNOWN',
  "last_synced_at" TIMESTAMP(3),
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "vehicle_telemetry_sources_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "vehicle_telemetry_snapshots" (
  "id" TEXT NOT NULL,
  "vehicle_id" TEXT NOT NULL,
  "provider" "TelemetryProviderType" NOT NULL,
  "provider_vehicle_id" TEXT,
  "collected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_synced_at" TIMESTAMP(3),
  "battery" JSONB,
  "gps" JSONB,
  "odometer" JSONB,
  "charging" JSONB,
  "faults" JSONB,
  "sources" JSONB,
  "raw_payload" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vehicle_telemetry_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "vehicle_telemetry_latest" (
  "vehicle_id" TEXT NOT NULL,
  "provider" "TelemetryProviderType" NOT NULL,
  "provider_vehicle_id" TEXT,
  "last_synced_at" TIMESTAMP(3),
  "sampled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "battery" JSONB,
  "gps" JSONB,
  "odometer" JSONB,
  "charging" JSONB,
  "faults" JSONB,
  "sources" JSONB,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "vehicle_telemetry_latest_pkey" PRIMARY KEY ("vehicle_id")
);

CREATE TABLE IF NOT EXISTS "vehicle_faults" (
  "id" TEXT NOT NULL,
  "vehicle_id" TEXT NOT NULL,
  "provider" "TelemetryProviderType",
  "source" TEXT,
  "code" TEXT NOT NULL,
  "severity" "VehicleFaultSeverity" NOT NULL DEFAULT 'WARNING',
  "description" TEXT NOT NULL,
  "status" "VehicleFaultLifecycleStatus" NOT NULL DEFAULT 'OPEN',
  "recommended_action" TEXT,
  "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acknowledged_at" TIMESTAMP(3),
  "acknowledged_by" TEXT,
  "resolved_at" TIMESTAMP(3),
  "resolved_by" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "vehicle_faults_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "webhook_deliveries" (
  "id" TEXT NOT NULL,
  "webhook_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMP(3),
  "delivered_at" TIMESTAMP(3),
  "last_error" TEXT,
  "response_status" INTEGER,
  "response_body" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "vehicles_organization_id_idx" ON "vehicles"("organization_id");
CREATE INDEX IF NOT EXISTS "vehicles_fleet_account_id_idx" ON "vehicles"("fleet_account_id");
CREATE INDEX IF NOT EXISTS "vehicles_fleet_driver_id_idx" ON "vehicles"("fleet_driver_id");
CREATE INDEX IF NOT EXISTS "vehicles_fleet_driver_group_id_idx" ON "vehicles"("fleet_driver_group_id");
CREATE INDEX IF NOT EXISTS "vehicles_depot_site_id_idx" ON "vehicles"("depot_site_id");
CREATE INDEX IF NOT EXISTS "vehicles_ownership_status_idx" ON "vehicles"("ownership_type", "vehicle_status");

CREATE INDEX IF NOT EXISTS "commands_domain_requested_at_idx" ON "commands"("domain", "requested_at");
CREATE INDEX IF NOT EXISTS "commands_vehicle_id_requested_at_idx" ON "commands"("vehicle_id", "requested_at");

CREATE INDEX IF NOT EXISTS "webhooks_organization_id_active_idx" ON "webhooks"("organization_id", "active");

CREATE UNIQUE INDEX IF NOT EXISTS "vehicle_tel_srcs_vehicle_provider_pvid_key"
  ON "vehicle_telemetry_sources"("vehicle_id", "provider", "provider_vehicle_id");
CREATE INDEX IF NOT EXISTS "vehicle_telemetry_sources_vehicle_enabled_idx"
  ON "vehicle_telemetry_sources"("vehicle_id", "enabled");
CREATE INDEX IF NOT EXISTS "vehicle_telemetry_sources_provider_health_idx"
  ON "vehicle_telemetry_sources"("provider", "health");

CREATE INDEX IF NOT EXISTS "vehicle_telemetry_snapshots_vehicle_collected_at_idx"
  ON "vehicle_telemetry_snapshots"("vehicle_id", "collected_at");
CREATE INDEX IF NOT EXISTS "vehicle_telemetry_snapshots_provider_collected_at_idx"
  ON "vehicle_telemetry_snapshots"("provider", "collected_at");

CREATE INDEX IF NOT EXISTS "vehicle_telemetry_latest_provider_updated_at_idx"
  ON "vehicle_telemetry_latest"("provider", "updated_at");

CREATE INDEX IF NOT EXISTS "vehicle_faults_vehicle_status_last_seen_at_idx"
  ON "vehicle_faults"("vehicle_id", "status", "last_seen_at");
CREATE INDEX IF NOT EXISTS "vehicle_faults_code_status_idx"
  ON "vehicle_faults"("code", "status");

CREATE INDEX IF NOT EXISTS "webhook_deliveries_status_next_attempt_at_idx"
  ON "webhook_deliveries"("status", "next_attempt_at");
CREATE INDEX IF NOT EXISTS "webhook_deliveries_webhook_id_created_at_idx"
  ON "webhook_deliveries"("webhook_id", "created_at");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vehicles_organization_id_fkey') THEN
    ALTER TABLE "vehicles"
      ADD CONSTRAINT "vehicles_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vehicles_fleet_account_id_fkey') THEN
    ALTER TABLE "vehicles"
      ADD CONSTRAINT "vehicles_fleet_account_id_fkey"
      FOREIGN KEY ("fleet_account_id") REFERENCES "fleet_accounts"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vehicles_fleet_driver_id_fkey') THEN
    ALTER TABLE "vehicles"
      ADD CONSTRAINT "vehicles_fleet_driver_id_fkey"
      FOREIGN KEY ("fleet_driver_id") REFERENCES "fleet_drivers"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vehicles_fleet_driver_group_id_fkey') THEN
    ALTER TABLE "vehicles"
      ADD CONSTRAINT "vehicles_fleet_driver_group_id_fkey"
      FOREIGN KEY ("fleet_driver_group_id") REFERENCES "fleet_driver_groups"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vehicles_depot_site_id_fkey') THEN
    ALTER TABLE "vehicles"
      ADD CONSTRAINT "vehicles_depot_site_id_fkey"
      FOREIGN KEY ("depot_site_id") REFERENCES "sites"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'commands_vehicle_id_fkey') THEN
    ALTER TABLE "commands"
      ADD CONSTRAINT "commands_vehicle_id_fkey"
      FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'webhooks_organization_id_fkey') THEN
    ALTER TABLE "webhooks"
      ADD CONSTRAINT "webhooks_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vehicle_telemetry_sources_vehicle_id_fkey') THEN
    ALTER TABLE "vehicle_telemetry_sources"
      ADD CONSTRAINT "vehicle_telemetry_sources_vehicle_id_fkey"
      FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vehicle_telemetry_snapshots_vehicle_id_fkey') THEN
    ALTER TABLE "vehicle_telemetry_snapshots"
      ADD CONSTRAINT "vehicle_telemetry_snapshots_vehicle_id_fkey"
      FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vehicle_telemetry_latest_vehicle_id_fkey') THEN
    ALTER TABLE "vehicle_telemetry_latest"
      ADD CONSTRAINT "vehicle_telemetry_latest_vehicle_id_fkey"
      FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vehicle_faults_vehicle_id_fkey') THEN
    ALTER TABLE "vehicle_faults"
      ADD CONSTRAINT "vehicle_faults_vehicle_id_fkey"
      FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'webhook_deliveries_webhook_id_fkey') THEN
    ALTER TABLE "webhook_deliveries"
      ADD CONSTRAINT "webhook_deliveries_webhook_id_fkey"
      FOREIGN KEY ("webhook_id") REFERENCES "webhooks"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

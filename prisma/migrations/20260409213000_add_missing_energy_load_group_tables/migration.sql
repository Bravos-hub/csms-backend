DO $$
BEGIN
  CREATE TYPE "EnergyControlMode" AS ENUM ('OBSERVE_ONLY', 'ACTIVE', 'DISABLED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "EnergyAllocationMethod" AS ENUM ('EQUAL', 'PRIORITY');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "EnergyMeterPlacement" AS ENUM ('MAIN', 'SUB_FEEDER', 'DERIVED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "EnergyAlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "EnergyAlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "EnergyDecisionState" AS ENUM ('APPLIED', 'DRY_RUN', 'NO_CHANGE', 'BLOCKED', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "EnergyOverrideStatus" AS ENUM ('ACTIVE', 'CLEARED', 'EXPIRED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "energy_load_groups" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "station_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "control_mode" "EnergyControlMode" NOT NULL DEFAULT 'OBSERVE_ONLY',
  "allocation_method" "EnergyAllocationMethod" NOT NULL DEFAULT 'EQUAL',
  "meter_source" TEXT,
  "meter_placement" "EnergyMeterPlacement" NOT NULL DEFAULT 'MAIN',
  "site_limit_amps_phase_1" INTEGER NOT NULL DEFAULT 0,
  "site_limit_amps_phase_2" INTEGER NOT NULL DEFAULT 0,
  "site_limit_amps_phase_3" INTEGER NOT NULL DEFAULT 0,
  "dynamic_buffer_amps_phase_1" INTEGER NOT NULL DEFAULT 0,
  "dynamic_buffer_amps_phase_2" INTEGER NOT NULL DEFAULT 0,
  "dynamic_buffer_amps_phase_3" INTEGER NOT NULL DEFAULT 0,
  "fail_safe_amps_phase_1" INTEGER NOT NULL DEFAULT 0,
  "fail_safe_amps_phase_2" INTEGER NOT NULL DEFAULT 0,
  "fail_safe_amps_phase_3" INTEGER NOT NULL DEFAULT 0,
  "deadband_amps" INTEGER NOT NULL DEFAULT 1,
  "stale_warning_after_sec" INTEGER NOT NULL DEFAULT 30,
  "fail_safe_after_sec" INTEGER NOT NULL DEFAULT 60,
  "command_refresh_sec" INTEGER NOT NULL DEFAULT 300,
  "is_active" BOOLEAN NOT NULL DEFAULT false,
  "observe_only" BOOLEAN NOT NULL DEFAULT true,
  "latest_telemetry_at" TIMESTAMP(3),
  "latest_decision_at" TIMESTAMP(3),
  "latest_decision_hash" TEXT,
  "latest_applied_at" TIMESTAMP(3),
  "latest_reason_code" TEXT,
  "last_meter_freshness_sec" INTEGER,
  "last_site_load_amps_phase_1" INTEGER,
  "last_site_load_amps_phase_2" INTEGER,
  "last_site_load_amps_phase_3" INTEGER,
  "last_non_ev_load_amps_phase_1" INTEGER,
  "last_non_ev_load_amps_phase_2" INTEGER,
  "last_non_ev_load_amps_phase_3" INTEGER,
  "last_headroom_amps_phase_1" INTEGER,
  "last_headroom_amps_phase_2" INTEGER,
  "last_headroom_amps_phase_3" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "energy_load_groups_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "energy_load_group_memberships" (
  "id" TEXT NOT NULL,
  "group_id" TEXT NOT NULL,
  "charge_point_id" TEXT NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "smart_charging_enabled" BOOLEAN NOT NULL DEFAULT false,
  "max_amps" INTEGER,
  "last_applied_amps" INTEGER,
  "last_applied_decision_hash" TEXT,
  "last_command_at" TIMESTAMP(3),
  "last_command_id" TEXT,
  "last_command_status" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "energy_load_group_memberships_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "energy_load_group_memberships_group_id_fkey"
    FOREIGN KEY ("group_id") REFERENCES "energy_load_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "energy_telemetry_snapshots" (
  "id" TEXT NOT NULL,
  "group_id" TEXT NOT NULL,
  "station_id" TEXT NOT NULL,
  "sampled_at" TIMESTAMP(3) NOT NULL,
  "meter_source" TEXT,
  "meter_placement" "EnergyMeterPlacement" NOT NULL DEFAULT 'MAIN',
  "site_load_amps_phase_1" INTEGER NOT NULL DEFAULT 0,
  "site_load_amps_phase_2" INTEGER NOT NULL DEFAULT 0,
  "site_load_amps_phase_3" INTEGER NOT NULL DEFAULT 0,
  "non_ev_load_amps_phase_1" INTEGER NOT NULL DEFAULT 0,
  "non_ev_load_amps_phase_2" INTEGER NOT NULL DEFAULT 0,
  "non_ev_load_amps_phase_3" INTEGER NOT NULL DEFAULT 0,
  "available_amps_phase_1" INTEGER NOT NULL DEFAULT 0,
  "available_amps_phase_2" INTEGER NOT NULL DEFAULT 0,
  "available_amps_phase_3" INTEGER NOT NULL DEFAULT 0,
  "headroom_amps_phase_1" INTEGER NOT NULL DEFAULT 0,
  "headroom_amps_phase_2" INTEGER NOT NULL DEFAULT 0,
  "headroom_amps_phase_3" INTEGER NOT NULL DEFAULT 0,
  "freshness_sec" INTEGER NOT NULL DEFAULT 0,
  "raw_telemetry" JSONB,
  "reason_code" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "energy_telemetry_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "energy_telemetry_snapshots_group_id_fkey"
    FOREIGN KEY ("group_id") REFERENCES "energy_load_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "energy_allocation_decisions" (
  "id" TEXT NOT NULL,
  "group_id" TEXT NOT NULL,
  "decision_hash" TEXT NOT NULL,
  "triggered_by" TEXT NOT NULL,
  "reason_code" TEXT NOT NULL,
  "state" "EnergyDecisionState" NOT NULL DEFAULT 'DRY_RUN',
  "input_snapshot" JSONB NOT NULL,
  "output_snapshot" JSONB NOT NULL,
  "command_count" INTEGER NOT NULL DEFAULT 0,
  "applied_at" TIMESTAMP(3),
  "related_override_id" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "energy_allocation_decisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "energy_allocation_decisions_group_id_fkey"
    FOREIGN KEY ("group_id") REFERENCES "energy_load_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "energy_alerts" (
  "id" TEXT NOT NULL,
  "group_id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "severity" "EnergyAlertSeverity" NOT NULL,
  "status" "EnergyAlertStatus" NOT NULL DEFAULT 'OPEN',
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "metadata" JSONB,
  "acknowledged_at" TIMESTAMP(3),
  "acknowledged_by" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "energy_alerts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "energy_alerts_group_id_fkey"
    FOREIGN KEY ("group_id") REFERENCES "energy_load_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "energy_manual_overrides" (
  "id" TEXT NOT NULL,
  "group_id" TEXT NOT NULL,
  "status" "EnergyOverrideStatus" NOT NULL DEFAULT 'ACTIVE',
  "reason" TEXT NOT NULL,
  "requested_by" TEXT,
  "cap_amps" INTEGER NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "cleared_at" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "energy_manual_overrides_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "energy_manual_overrides_group_id_fkey"
    FOREIGN KEY ("group_id") REFERENCES "energy_load_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "energy_load_groups_tenant_id_station_id_is_active_idx"
  ON "energy_load_groups"("tenant_id", "station_id", "is_active");

CREATE INDEX IF NOT EXISTS "energy_load_groups_tenant_id_station_id_control_mode_idx"
  ON "energy_load_groups"("tenant_id", "station_id", "control_mode");

CREATE UNIQUE INDEX IF NOT EXISTS "energy_load_groups_tenant_id_station_id_name_key"
  ON "energy_load_groups"("tenant_id", "station_id", "name");

CREATE INDEX IF NOT EXISTS "energy_load_group_memberships_charge_point_id_idx"
  ON "energy_load_group_memberships"("charge_point_id");

CREATE INDEX IF NOT EXISTS "energy_load_group_memberships_group_id_priority_idx"
  ON "energy_load_group_memberships"("group_id", "priority");

CREATE UNIQUE INDEX IF NOT EXISTS "energy_load_group_memberships_group_id_charge_point_id_key"
  ON "energy_load_group_memberships"("group_id", "charge_point_id");

CREATE INDEX IF NOT EXISTS "energy_telemetry_snapshots_group_id_sampled_at_idx"
  ON "energy_telemetry_snapshots"("group_id", "sampled_at");

CREATE INDEX IF NOT EXISTS "energy_telemetry_snapshots_station_id_sampled_at_idx"
  ON "energy_telemetry_snapshots"("station_id", "sampled_at");

CREATE INDEX IF NOT EXISTS "energy_allocation_decisions_group_id_createdAt_idx"
  ON "energy_allocation_decisions"("group_id", "createdAt");

CREATE INDEX IF NOT EXISTS "energy_allocation_decisions_decision_hash_idx"
  ON "energy_allocation_decisions"("decision_hash");

CREATE INDEX IF NOT EXISTS "energy_alerts_group_id_status_createdAt_idx"
  ON "energy_alerts"("group_id", "status", "createdAt");

CREATE INDEX IF NOT EXISTS "energy_alerts_code_status_idx"
  ON "energy_alerts"("code", "status");

CREATE INDEX IF NOT EXISTS "energy_manual_overrides_group_id_status_expires_at_idx"
  ON "energy_manual_overrides"("group_id", "status", "expires_at");

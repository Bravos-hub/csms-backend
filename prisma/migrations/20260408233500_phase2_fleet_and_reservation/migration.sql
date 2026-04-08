-- Phase 2: reservations lifecycle hardening + fleet/driver domain

ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "reservation_id" INTEGER,
  ADD COLUMN IF NOT EXISTS "reservation_command_id" TEXT,
  ADD COLUMN IF NOT EXISTS "reservation_command_status" TEXT,
  ADD COLUMN IF NOT EXISTS "reservation_command_updated_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reservation_source" TEXT DEFAULT 'LOCAL',
  ADD COLUMN IF NOT EXISTS "command_correlation_id" TEXT,
  ADD COLUMN IF NOT EXISTS "checked_in_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cancelled_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "no_show_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "expired_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "bookings_reservation_id_idx"
  ON "bookings" ("reservation_id");

CREATE INDEX IF NOT EXISTS "bookings_reservation_command_id_idx"
  ON "bookings" ("reservation_command_id");

CREATE INDEX IF NOT EXISTS "bookings_status_startTime_idx"
  ON "bookings" ("status", "startTime");

CREATE TABLE IF NOT EXISTS "booking_events" (
  "id" TEXT NOT NULL,
  "booking_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "status" TEXT,
  "source" TEXT,
  "details" JSONB,
  "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "booking_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "booking_events_booking_id_occurred_at_idx"
  ON "booking_events" ("booking_id", "occurred_at");

CREATE INDEX IF NOT EXISTS "booking_events_event_type_occurred_at_idx"
  ON "booking_events" ("event_type", "occurred_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'booking_events_booking_id_fkey'
  ) THEN
    ALTER TABLE "booking_events"
      ADD CONSTRAINT "booking_events_booking_id_fkey"
      FOREIGN KEY ("booking_id") REFERENCES "bookings"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "fleet_accounts" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "code" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "currency" TEXT NOT NULL DEFAULT 'UGX',
  "monthly_spend_limit" DOUBLE PRECISION,
  "daily_spend_limit" DOUBLE PRECISION,
  "metadata" JSONB,
  "created_by" TEXT,
  "updated_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "fleet_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "fleet_driver_groups" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "fleet_account_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "tariff_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "location_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "monthly_spend_limit" DOUBLE PRECISION,
  "daily_spend_limit" DOUBLE PRECISION,
  "metadata" JSONB,
  "created_by" TEXT,
  "updated_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "fleet_driver_groups_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "fleet_drivers" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "fleet_account_id" TEXT NOT NULL,
  "group_id" TEXT,
  "user_id" TEXT,
  "display_name" TEXT NOT NULL,
  "email" TEXT,
  "phone" TEXT,
  "external_ref" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "monthly_spend_limit" DOUBLE PRECISION,
  "daily_spend_limit" DOUBLE PRECISION,
  "metadata" JSONB,
  "created_by" TEXT,
  "updated_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "fleet_drivers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "fleet_driver_tokens" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "driver_id" TEXT NOT NULL,
  "token_uid" TEXT NOT NULL,
  "token_type" TEXT NOT NULL DEFAULT 'RFID',
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" TIMESTAMP(3),
  "metadata" JSONB,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "fleet_driver_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "fleet_accounts_organization_id_name_key"
  ON "fleet_accounts" ("organization_id", "name");

CREATE UNIQUE INDEX IF NOT EXISTS "fleet_driver_groups_fleet_account_id_name_key"
  ON "fleet_driver_groups" ("fleet_account_id", "name");

CREATE UNIQUE INDEX IF NOT EXISTS "fleet_driver_tokens_organization_id_token_uid_token_type_key"
  ON "fleet_driver_tokens" ("organization_id", "token_uid", "token_type");

CREATE INDEX IF NOT EXISTS "fleet_accounts_organization_id_status_idx"
  ON "fleet_accounts" ("organization_id", "status");

CREATE INDEX IF NOT EXISTS "fleet_driver_groups_organization_id_status_idx"
  ON "fleet_driver_groups" ("organization_id", "status");

CREATE INDEX IF NOT EXISTS "fleet_driver_groups_fleet_account_id_status_idx"
  ON "fleet_driver_groups" ("fleet_account_id", "status");

CREATE INDEX IF NOT EXISTS "fleet_drivers_organization_id_status_idx"
  ON "fleet_drivers" ("organization_id", "status");

CREATE INDEX IF NOT EXISTS "fleet_drivers_fleet_account_id_status_idx"
  ON "fleet_drivers" ("fleet_account_id", "status");

CREATE INDEX IF NOT EXISTS "fleet_drivers_group_id_status_idx"
  ON "fleet_drivers" ("group_id", "status");

CREATE INDEX IF NOT EXISTS "fleet_drivers_user_id_idx"
  ON "fleet_drivers" ("user_id");

CREATE INDEX IF NOT EXISTS "fleet_driver_tokens_driver_id_status_idx"
  ON "fleet_driver_tokens" ("driver_id", "status");

CREATE INDEX IF NOT EXISTS "fleet_driver_tokens_organization_id_status_idx"
  ON "fleet_driver_tokens" ("organization_id", "status");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fleet_accounts_organization_id_fkey'
  ) THEN
    ALTER TABLE "fleet_accounts"
      ADD CONSTRAINT "fleet_accounts_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fleet_driver_groups_organization_id_fkey'
  ) THEN
    ALTER TABLE "fleet_driver_groups"
      ADD CONSTRAINT "fleet_driver_groups_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fleet_driver_groups_fleet_account_id_fkey'
  ) THEN
    ALTER TABLE "fleet_driver_groups"
      ADD CONSTRAINT "fleet_driver_groups_fleet_account_id_fkey"
      FOREIGN KEY ("fleet_account_id") REFERENCES "fleet_accounts"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fleet_drivers_organization_id_fkey'
  ) THEN
    ALTER TABLE "fleet_drivers"
      ADD CONSTRAINT "fleet_drivers_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fleet_drivers_fleet_account_id_fkey'
  ) THEN
    ALTER TABLE "fleet_drivers"
      ADD CONSTRAINT "fleet_drivers_fleet_account_id_fkey"
      FOREIGN KEY ("fleet_account_id") REFERENCES "fleet_accounts"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fleet_drivers_group_id_fkey'
  ) THEN
    ALTER TABLE "fleet_drivers"
      ADD CONSTRAINT "fleet_drivers_group_id_fkey"
      FOREIGN KEY ("group_id") REFERENCES "fleet_driver_groups"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fleet_drivers_user_id_fkey'
  ) THEN
    ALTER TABLE "fleet_drivers"
      ADD CONSTRAINT "fleet_drivers_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fleet_driver_tokens_organization_id_fkey'
  ) THEN
    ALTER TABLE "fleet_driver_tokens"
      ADD CONSTRAINT "fleet_driver_tokens_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fleet_driver_tokens_driver_id_fkey'
  ) THEN
    ALTER TABLE "fleet_driver_tokens"
      ADD CONSTRAINT "fleet_driver_tokens_driver_id_fkey"
      FOREIGN KEY ("driver_id") REFERENCES "fleet_drivers"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

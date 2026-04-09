-- Phase 3: Plug & Charge + Enterprise IAM/SSO + Developer Platform + DER hooks

CREATE TABLE IF NOT EXISTS "energy_der_profiles" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "station_id" TEXT NOT NULL,
  "site_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "max_grid_import_kw" DOUBLE PRECISION,
  "reserve_grid_kw" DOUBLE PRECISION,
  "solar_enabled" BOOLEAN NOT NULL DEFAULT false,
  "max_solar_contribution_kw" DOUBLE PRECISION,
  "bess_enabled" BOOLEAN NOT NULL DEFAULT false,
  "max_bess_discharge_kw" DOUBLE PRECISION,
  "bess_soc_percent" DOUBLE PRECISION,
  "bess_reserve_soc_percent" DOUBLE PRECISION,
  "forecast" JSONB,
  "metadata" JSONB,
  "created_by" TEXT,
  "updated_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "energy_der_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "pnc_contracts" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "contract_ref" TEXT NOT NULL,
  "e_mobility_account_id" TEXT,
  "provider_party_id" TEXT,
  "vehicle_vin" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "metadata" JSONB,
  "created_by" TEXT,
  "updated_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "pnc_contracts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "pnc_contract_certificates" (
  "id" TEXT NOT NULL,
  "contract_id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "certificate_hash" TEXT NOT NULL,
  "certificate_type" TEXT NOT NULL DEFAULT 'CONTRACT',
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "valid_from" TIMESTAMP(3),
  "valid_to" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),
  "revocation_reason" TEXT,
  "mapped_charge_point_ids" JSONB,
  "diagnostics" JSONB,
  "created_by" TEXT,
  "updated_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "pnc_contract_certificates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "pnc_certificate_events" (
  "id" TEXT NOT NULL,
  "certificate_id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "status" TEXT,
  "details" JSONB,
  "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pnc_certificate_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "enterprise_identity_providers" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "protocol" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "issuer_url" TEXT,
  "authorization_url" TEXT,
  "token_url" TEXT,
  "user_info_url" TEXT,
  "jwks_url" TEXT,
  "saml_metadata_url" TEXT,
  "saml_entity_id" TEXT,
  "saml_acs_url" TEXT,
  "client_id" TEXT,
  "client_secret_ref" TEXT,
  "role_mappings" JSONB,
  "sync_mode" TEXT NOT NULL DEFAULT 'MANUAL_IMPORT',
  "last_sync_at" TIMESTAMP(3),
  "metadata" JSONB,
  "created_by" TEXT,
  "updated_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "enterprise_identity_providers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "enterprise_identity_sync_jobs" (
  "id" TEXT NOT NULL,
  "provider_id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "trigger_type" TEXT NOT NULL DEFAULT 'MANUAL_IMPORT',
  "status" TEXT NOT NULL DEFAULT 'REVIEW_REQUIRED',
  "imported_users" INTEGER NOT NULL DEFAULT 0,
  "imported_groups" INTEGER NOT NULL DEFAULT 0,
  "rejected_records" INTEGER NOT NULL DEFAULT 0,
  "payload_digest" TEXT,
  "summary" JSONB,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "enterprise_identity_sync_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "developer_apps" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "description" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "default_rate_limit_per_min" INTEGER NOT NULL DEFAULT 120,
  "metadata" JSONB,
  "created_by" TEXT,
  "updated_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "developer_apps_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "developer_api_keys" (
  "id" TEXT NOT NULL,
  "app_id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "key_prefix" TEXT NOT NULL,
  "secret_hash" TEXT NOT NULL,
  "secret_salt" TEXT NOT NULL,
  "scopes" JSONB,
  "rate_limit_per_min" INTEGER NOT NULL DEFAULT 120,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "last_used_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),
  "metadata" JSONB,
  "created_by" TEXT,
  "updated_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "developer_api_keys_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "developer_api_usage" (
  "id" TEXT NOT NULL,
  "app_id" TEXT NOT NULL,
  "api_key_id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "route" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "window_start" TIMESTAMP(3) NOT NULL,
  "window_end" TIMESTAMP(3) NOT NULL,
  "request_count" INTEGER NOT NULL DEFAULT 0,
  "denied_count" INTEGER NOT NULL DEFAULT 0,
  "latest_reason" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "developer_api_usage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "energy_der_profiles_tenant_id_station_id_key"
  ON "energy_der_profiles" ("tenant_id", "station_id");

CREATE UNIQUE INDEX IF NOT EXISTS "pnc_contracts_organization_id_contract_ref_key"
  ON "pnc_contracts" ("organization_id", "contract_ref");

CREATE UNIQUE INDEX IF NOT EXISTS "pnc_contract_certificates_organization_id_certificate_hash_key"
  ON "pnc_contract_certificates" ("organization_id", "certificate_hash");

CREATE UNIQUE INDEX IF NOT EXISTS "enterprise_identity_providers_organization_id_name_key"
  ON "enterprise_identity_providers" ("organization_id", "name");

CREATE UNIQUE INDEX IF NOT EXISTS "developer_apps_organization_id_slug_key"
  ON "developer_apps" ("organization_id", "slug");

CREATE UNIQUE INDEX IF NOT EXISTS "developer_api_keys_key_prefix_key"
  ON "developer_api_keys" ("key_prefix");

CREATE UNIQUE INDEX IF NOT EXISTS "developer_api_usage_api_key_id_route_method_window_start_key"
  ON "developer_api_usage" ("api_key_id", "route", "method", "window_start");

CREATE INDEX IF NOT EXISTS "energy_der_profiles_organization_id_status_idx"
  ON "energy_der_profiles" ("organization_id", "status");

CREATE INDEX IF NOT EXISTS "energy_der_profiles_tenant_id_status_updated_at_idx"
  ON "energy_der_profiles" ("tenant_id", "status", "updated_at");

CREATE INDEX IF NOT EXISTS "pnc_contracts_organization_id_status_idx"
  ON "pnc_contracts" ("organization_id", "status");

CREATE INDEX IF NOT EXISTS "pnc_contract_certificates_contract_id_status_idx"
  ON "pnc_contract_certificates" ("contract_id", "status");

CREATE INDEX IF NOT EXISTS "pnc_contract_certificates_organization_id_status_valid_to_idx"
  ON "pnc_contract_certificates" ("organization_id", "status", "valid_to");

CREATE INDEX IF NOT EXISTS "pnc_certificate_events_certificate_id_occurred_at_idx"
  ON "pnc_certificate_events" ("certificate_id", "occurred_at");

CREATE INDEX IF NOT EXISTS "pnc_certificate_events_organization_id_event_type_occurred_at_idx"
  ON "pnc_certificate_events" ("organization_id", "event_type", "occurred_at");

CREATE INDEX IF NOT EXISTS "enterprise_identity_providers_organization_id_status_idx"
  ON "enterprise_identity_providers" ("organization_id", "status");

CREATE INDEX IF NOT EXISTS "enterprise_identity_sync_jobs_provider_id_created_at_idx"
  ON "enterprise_identity_sync_jobs" ("provider_id", "created_at");

CREATE INDEX IF NOT EXISTS "enterprise_identity_sync_jobs_organization_id_status_created_at_idx"
  ON "enterprise_identity_sync_jobs" ("organization_id", "status", "created_at");

CREATE INDEX IF NOT EXISTS "developer_apps_organization_id_status_updated_at_idx"
  ON "developer_apps" ("organization_id", "status", "updated_at");

CREATE INDEX IF NOT EXISTS "developer_api_keys_app_id_status_idx"
  ON "developer_api_keys" ("app_id", "status");

CREATE INDEX IF NOT EXISTS "developer_api_keys_organization_id_status_updated_at_idx"
  ON "developer_api_keys" ("organization_id", "status", "updated_at");

CREATE INDEX IF NOT EXISTS "developer_api_usage_organization_id_window_start_idx"
  ON "developer_api_usage" ("organization_id", "window_start");

CREATE INDEX IF NOT EXISTS "developer_api_usage_app_id_window_start_idx"
  ON "developer_api_usage" ("app_id", "window_start");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'energy_der_profiles_organization_id_fkey'
  ) THEN
    ALTER TABLE "energy_der_profiles"
      ADD CONSTRAINT "energy_der_profiles_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'energy_der_profiles_station_id_fkey'
  ) THEN
    ALTER TABLE "energy_der_profiles"
      ADD CONSTRAINT "energy_der_profiles_station_id_fkey"
      FOREIGN KEY ("station_id") REFERENCES "stations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pnc_contracts_organization_id_fkey'
  ) THEN
    ALTER TABLE "pnc_contracts"
      ADD CONSTRAINT "pnc_contracts_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pnc_contract_certificates_contract_id_fkey'
  ) THEN
    ALTER TABLE "pnc_contract_certificates"
      ADD CONSTRAINT "pnc_contract_certificates_contract_id_fkey"
      FOREIGN KEY ("contract_id") REFERENCES "pnc_contracts"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pnc_contract_certificates_organization_id_fkey'
  ) THEN
    ALTER TABLE "pnc_contract_certificates"
      ADD CONSTRAINT "pnc_contract_certificates_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pnc_certificate_events_certificate_id_fkey'
  ) THEN
    ALTER TABLE "pnc_certificate_events"
      ADD CONSTRAINT "pnc_certificate_events_certificate_id_fkey"
      FOREIGN KEY ("certificate_id") REFERENCES "pnc_contract_certificates"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pnc_certificate_events_organization_id_fkey'
  ) THEN
    ALTER TABLE "pnc_certificate_events"
      ADD CONSTRAINT "pnc_certificate_events_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'enterprise_identity_providers_organization_id_fkey'
  ) THEN
    ALTER TABLE "enterprise_identity_providers"
      ADD CONSTRAINT "enterprise_identity_providers_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'enterprise_identity_sync_jobs_provider_id_fkey'
  ) THEN
    ALTER TABLE "enterprise_identity_sync_jobs"
      ADD CONSTRAINT "enterprise_identity_sync_jobs_provider_id_fkey"
      FOREIGN KEY ("provider_id") REFERENCES "enterprise_identity_providers"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'enterprise_identity_sync_jobs_organization_id_fkey'
  ) THEN
    ALTER TABLE "enterprise_identity_sync_jobs"
      ADD CONSTRAINT "enterprise_identity_sync_jobs_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'developer_apps_organization_id_fkey'
  ) THEN
    ALTER TABLE "developer_apps"
      ADD CONSTRAINT "developer_apps_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'developer_api_keys_app_id_fkey'
  ) THEN
    ALTER TABLE "developer_api_keys"
      ADD CONSTRAINT "developer_api_keys_app_id_fkey"
      FOREIGN KEY ("app_id") REFERENCES "developer_apps"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'developer_api_keys_organization_id_fkey'
  ) THEN
    ALTER TABLE "developer_api_keys"
      ADD CONSTRAINT "developer_api_keys_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'developer_api_usage_app_id_fkey'
  ) THEN
    ALTER TABLE "developer_api_usage"
      ADD CONSTRAINT "developer_api_usage_app_id_fkey"
      FOREIGN KEY ("app_id") REFERENCES "developer_apps"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'developer_api_usage_api_key_id_fkey'
  ) THEN
    ALTER TABLE "developer_api_usage"
      ADD CONSTRAINT "developer_api_usage_api_key_id_fkey"
      FOREIGN KEY ("api_key_id") REFERENCES "developer_api_keys"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'developer_api_usage_organization_id_fkey'
  ) THEN
    ALTER TABLE "developer_api_usage"
      ADD CONSTRAINT "developer_api_usage_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

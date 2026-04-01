DO $$
BEGIN
  CREATE TYPE "TenantTier" AS ENUM ('SHARED', 'SCHEMA', 'DEDICATED_DB');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "tenant_subdomain" TEXT,
  ADD COLUMN IF NOT EXISTS "tenant_tier" "TenantTier" NOT NULL DEFAULT 'SHARED',
  ADD COLUMN IF NOT EXISTS "tenant_schema" TEXT,
  ADD COLUMN IF NOT EXISTS "tenant_routing_enabled" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS "organizations_tenant_subdomain_key"
  ON "organizations" ("tenant_subdomain");

ALTER TABLE "commands"
  ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;

CREATE INDEX IF NOT EXISTS "commands_tenant_id_requested_at_idx"
  ON "commands" ("tenant_id", "requested_at");

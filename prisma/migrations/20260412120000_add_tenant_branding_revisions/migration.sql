DO $$
BEGIN
  CREATE TYPE "TenantBrandingRevisionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ROLLED_BACK');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "tenant_branding_revisions" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "TenantBrandingRevisionStatus" NOT NULL,
  "config_json" JSONB NOT NULL,
  "published_at" TIMESTAMP(3),
  "rolled_back_from_version" INTEGER,
  "created_by" TEXT,
  "updated_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tenant_branding_revisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tenant_branding_revisions_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "tenant_branding_revisions_organization_id_version_key"
  ON "tenant_branding_revisions" ("organization_id", "version");

CREATE INDEX IF NOT EXISTS "tenant_branding_revisions_organization_id_status_idx"
  ON "tenant_branding_revisions" ("organization_id", "status");

CREATE INDEX IF NOT EXISTS "tenant_branding_revisions_organization_id_created_at_idx"
  ON "tenant_branding_revisions" ("organization_id", "created_at");

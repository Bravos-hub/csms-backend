CREATE TABLE IF NOT EXISTS "platform_tier_pricing_versions" (
  "id" TEXT NOT NULL,
  "tier_code" TEXT NOT NULL,
  "tier_label" TEXT NOT NULL,
  "deployment_model" TEXT NOT NULL,
  "account_types" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "is_custom_pricing" BOOLEAN NOT NULL DEFAULT false,
  "monthly_price" DECIMAL(10,2),
  "annual_price" DECIMAL(10,2),
  "setup_fee" DECIMAL(10,2),
  "white_label_available" BOOLEAN NOT NULL DEFAULT false,
  "white_label_monthly_addon" DECIMAL(10,2),
  "white_label_setup_fee" DECIMAL(10,2),
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "version" INTEGER NOT NULL,
  "notes" TEXT,
  "effective_from" TIMESTAMP(3),
  "effective_to" TIMESTAMP(3),
  "created_by" TEXT,
  "published_by" TEXT,
  "published_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_tier_pricing_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "platform_tier_pricing_versions_tier_code_version_key"
  ON "platform_tier_pricing_versions" ("tier_code", "version");

CREATE INDEX IF NOT EXISTS "platform_tier_pricing_tier_status_idx"
  ON "platform_tier_pricing_versions" ("tier_code", "status");

CREATE INDEX IF NOT EXISTS "platform_tier_pricing_status_effective_idx"
  ON "platform_tier_pricing_versions" ("status", "effective_from");

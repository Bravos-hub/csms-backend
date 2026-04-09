ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "primary_domain" TEXT,
  ADD COLUMN IF NOT EXISTS "allowed_origins" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "white_label_config" JSONB,
  ADD COLUMN IF NOT EXISTS "billing_plan_code" TEXT,
  ADD COLUMN IF NOT EXISTS "billing_status" TEXT,
  ADD COLUMN IF NOT EXISTS "suspended_at" TIMESTAMP(3);

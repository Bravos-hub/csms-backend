DO $$
BEGIN
  CREATE TYPE "CpoServiceType" AS ENUM ('CHARGE', 'SWAP', 'HYBRID');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "tenant_applications"
  ADD COLUMN IF NOT EXISTS "cpo_type" "CpoServiceType" NOT NULL DEFAULT 'CHARGE';

ALTER TABLE "platform_tier_pricing_versions"
  ADD COLUMN IF NOT EXISTS "swap_monthly_addon" DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS "swap_annual_addon" DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS "swap_setup_addon" DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS "hybrid_monthly_addon" DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS "hybrid_annual_addon" DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS "hybrid_setup_addon" DECIMAL(10, 2);

UPDATE "platform_tier_pricing_versions"
SET
  "swap_monthly_addon" = COALESCE("swap_monthly_addon", CASE "tier_code"
    WHEN 'T1' THEN 49
    WHEN 'T2' THEN 149
    WHEN 'T3' THEN 590
    ELSE NULL
  END),
  "swap_annual_addon" = COALESCE("swap_annual_addon", CASE "tier_code"
    WHEN 'T1' THEN 500
    WHEN 'T2' THEN 1520
    WHEN 'T3' THEN 6018
    ELSE NULL
  END),
  "swap_setup_addon" = COALESCE("swap_setup_addon", CASE "tier_code"
    WHEN 'T1' THEN 100
    WHEN 'T2' THEN 300
    WHEN 'T3' THEN 2500
    ELSE NULL
  END),
  "hybrid_monthly_addon" = COALESCE("hybrid_monthly_addon", CASE "tier_code"
    WHEN 'T1' THEN 119
    WHEN 'T2' THEN 239
    WHEN 'T3' THEN 890
    ELSE NULL
  END),
  "hybrid_annual_addon" = COALESCE("hybrid_annual_addon", CASE "tier_code"
    WHEN 'T1' THEN 1214
    WHEN 'T2' THEN 2438
    WHEN 'T3' THEN 9078
    ELSE NULL
  END),
  "hybrid_setup_addon" = COALESCE("hybrid_setup_addon", CASE "tier_code"
    WHEN 'T1' THEN 150
    WHEN 'T2' THEN 450
    WHEN 'T3' THEN 3500
    ELSE NULL
  END);

ALTER TABLE "geographic_zones"
    ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE "geographic_zones"
SET "isActive" = TRUE
WHERE "isActive" IS DISTINCT FROM TRUE;

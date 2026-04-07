ALTER TABLE "charge_points"
ADD COLUMN "boot_notification_at" TIMESTAMP(3),
ADD COLUMN "boot_notification_payload" JSONB,
ADD COLUMN "identity_confirmed_at" TIMESTAMP(3);

UPDATE "charge_points"
SET "identity_confirmed_at" = COALESCE("lastHeartbeat", "updatedAt", NOW())
WHERE "identity_confirmed_at" IS NULL
  AND NULLIF(BTRIM(COALESCE("model", '')), '') IS NOT NULL
  AND NULLIF(BTRIM(COALESCE("vendor", '')), '') IS NOT NULL
  AND NULLIF(BTRIM(COALESCE("firmwareVersion", '')), '') IS NOT NULL;
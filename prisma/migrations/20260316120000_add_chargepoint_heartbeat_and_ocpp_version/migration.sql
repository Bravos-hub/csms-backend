-- Align charge point operational visibility fields used by backend/gateway/portal.
ALTER TABLE "charge_points"
ADD COLUMN IF NOT EXISTS "ocppVersion" TEXT NOT NULL DEFAULT '1.6',
ADD COLUMN IF NOT EXISTS "lastHeartbeat" TIMESTAMP(3);

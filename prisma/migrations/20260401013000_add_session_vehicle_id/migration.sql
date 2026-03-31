-- Add missing optional vehicle link for session records.
ALTER TABLE "sessions"
ADD COLUMN IF NOT EXISTS "vehicleId" TEXT;

-- Keep lookups efficient for vehicle-scoped session queries.
CREATE INDEX IF NOT EXISTS "sessions_vehicleId_idx" ON "sessions"("vehicleId");

DO $$
BEGIN
  ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_vehicleId_fkey"
  FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

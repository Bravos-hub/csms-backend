DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TelemetryIngestAlertType') THEN
    CREATE TYPE "TelemetryIngestAlertType" AS ENUM ('INGEST_LAG', 'STALE');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "telemetry_ingest_alerts" (
  "id" TEXT NOT NULL,
  "type" "TelemetryIngestAlertType" NOT NULL,
  "provider" "TelemetryProviderType" NOT NULL,
  "provider_vehicle_id" TEXT,
  "vehicle_id" TEXT NOT NULL,
  "observed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lag_ms" INTEGER,
  "message" TEXT NOT NULL,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "telemetry_ingest_alerts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "telemetry_ingest_alerts_type_observed_at_idx"
  ON "telemetry_ingest_alerts"("type", "observed_at");

CREATE INDEX IF NOT EXISTS "telemetry_ingest_alerts_vehicle_observed_at_idx"
  ON "telemetry_ingest_alerts"("vehicle_id", "observed_at");

CREATE INDEX IF NOT EXISTS "telemetry_ingest_alerts_provider_observed_at_idx"
  ON "telemetry_ingest_alerts"("provider", "observed_at");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'telemetry_ingest_alerts_vehicle_id_fkey') THEN
    ALTER TABLE "telemetry_ingest_alerts"
      ADD CONSTRAINT "telemetry_ingest_alerts_vehicle_id_fkey"
      FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

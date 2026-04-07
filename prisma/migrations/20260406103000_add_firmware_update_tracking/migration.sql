-- Add firmware update snapshot fields on charge points
ALTER TABLE "charge_points"
ADD COLUMN "firmware_update_status" TEXT,
ADD COLUMN "firmware_update_request_id" INTEGER,
ADD COLUMN "firmware_status_updated_at" TIMESTAMP(3);

-- Persist firmware update status history from OCPP station events
CREATE TABLE "firmware_update_events" (
    "id" TEXT NOT NULL,
    "gateway_event_id" TEXT NOT NULL,
    "charge_point_id" TEXT NOT NULL,
    "station_id" TEXT,
    "ocpp_version" TEXT,
    "request_id" INTEGER,
    "status" TEXT NOT NULL,
    "payload" JSONB,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "firmware_update_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "firmware_update_events_gateway_event_id_key" ON "firmware_update_events"("gateway_event_id");
CREATE INDEX "firmware_update_events_charge_point_id_occurred_at_idx" ON "firmware_update_events"("charge_point_id", "occurred_at");
CREATE INDEX "firmware_update_events_station_id_occurred_at_idx" ON "firmware_update_events"("station_id", "occurred_at");
CREATE INDEX "firmware_update_events_status_occurred_at_idx" ON "firmware_update_events"("status", "occurred_at");

ALTER TABLE "firmware_update_events"
ADD CONSTRAINT "firmware_update_events_charge_point_id_fkey"
FOREIGN KEY ("charge_point_id") REFERENCES "charge_points"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

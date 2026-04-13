-- Add explicit provider tracking fields to payment intents
ALTER TABLE "payment_intents"
  ADD COLUMN "provider" TEXT,
  ADD COLUMN "market" TEXT,
  ADD COLUMN "provider_payment_id" TEXT;

CREATE INDEX "payment_intents_provider_provider_payment_id_idx"
  ON "payment_intents"("provider", "provider_payment_id");

-- Persist payment webhook deliveries for idempotent processing and auditability
CREATE TABLE "payment_webhook_events" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "event_id" TEXT NOT NULL,
  "event_type" TEXT,
  "payment_intent_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'RECEIVED',
  "payload" JSONB,
  "error_message" TEXT,
  "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "payment_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payment_webhook_events_provider_event_id_key"
  ON "payment_webhook_events"("provider", "event_id");

CREATE INDEX "payment_webhook_events_status_created_at_idx"
  ON "payment_webhook_events"("status", "created_at");

CREATE INDEX "payment_webhook_events_payment_intent_id_created_at_idx"
  ON "payment_webhook_events"("payment_intent_id", "created_at");

ALTER TABLE "payment_webhook_events"
  ADD CONSTRAINT "payment_webhook_events_payment_intent_id_fkey"
  FOREIGN KEY ("payment_intent_id") REFERENCES "payment_intents"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

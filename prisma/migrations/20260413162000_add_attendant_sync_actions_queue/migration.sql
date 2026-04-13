CREATE TABLE IF NOT EXISTS "attendant_sync_actions" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "action_type" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "source_created_at" TIMESTAMP(3),
  "processed_at" TIMESTAMP(3),
  "error_message" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "attendant_sync_actions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "attendant_sync_actions_user_id_idempotency_key_key"
  ON "attendant_sync_actions"("user_id", "idempotency_key");

CREATE INDEX IF NOT EXISTS "attendant_sync_actions_user_id_status_created_at_idx"
  ON "attendant_sync_actions"("user_id", "status", "created_at");

ALTER TABLE "commands"
  ADD COLUMN IF NOT EXISTS "idempotency_ttl_sec" INTEGER;

-- Rollback for 20260222090000_command_pipeline_hardening
-- Run manually with psql if this migration must be reverted.

SET lock_timeout = '5s';

ALTER TABLE IF EXISTS "command_outbox"
  DROP CONSTRAINT IF EXISTS "command_outbox_command_id_fkey";

ALTER TABLE IF EXISTS "command_events"
  DROP CONSTRAINT IF EXISTS "command_events_command_id_fkey";

DROP INDEX IF EXISTS "commands_correlation_id_idx";
DROP INDEX IF EXISTS "commands_status_requested_at_idx";
DROP INDEX IF EXISTS "command_outbox_status_locked_at_created_at_idx";
DROP INDEX IF EXISTS "command_outbox_status_updated_at_idx";
DROP INDEX IF EXISTS "command_outbox_command_id_idx";
DROP INDEX IF EXISTS "command_events_command_id_occurred_at_idx";
DROP INDEX IF EXISTS "command_events_status_occurred_at_idx";

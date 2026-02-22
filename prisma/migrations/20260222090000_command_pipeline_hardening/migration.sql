-- Command pipeline hardening: indexes for hot paths and relational integrity constraints.

CREATE INDEX IF NOT EXISTS "commands_correlation_id_idx"
    ON "commands" ("correlation_id");

CREATE INDEX IF NOT EXISTS "commands_status_requested_at_idx"
    ON "commands" ("status", "requested_at");

CREATE INDEX IF NOT EXISTS "command_outbox_status_locked_at_created_at_idx"
    ON "command_outbox" ("status", "locked_at", "created_at");

CREATE INDEX IF NOT EXISTS "command_outbox_status_updated_at_idx"
    ON "command_outbox" ("status", "updated_at");

CREATE INDEX IF NOT EXISTS "command_outbox_command_id_idx"
    ON "command_outbox" ("command_id");

CREATE INDEX IF NOT EXISTS "command_events_command_id_occurred_at_idx"
    ON "command_events" ("command_id", "occurred_at");

CREATE INDEX IF NOT EXISTS "command_events_status_occurred_at_idx"
    ON "command_events" ("status", "occurred_at");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'command_outbox_command_id_fkey'
    ) THEN
        ALTER TABLE "command_outbox"
            ADD CONSTRAINT "command_outbox_command_id_fkey"
            FOREIGN KEY ("command_id") REFERENCES "commands"("id")
            ON DELETE CASCADE
            ON UPDATE CASCADE
            NOT VALID;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'command_events_command_id_fkey'
    ) THEN
        ALTER TABLE "command_events"
            ADD CONSTRAINT "command_events_command_id_fkey"
            FOREIGN KEY ("command_id") REFERENCES "commands"("id")
            ON DELETE CASCADE
            ON UPDATE CASCADE
            NOT VALID;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM "command_outbox" o
        LEFT JOIN "commands" c ON c."id" = o."command_id"
        WHERE c."id" IS NULL
    ) THEN
        ALTER TABLE "command_outbox"
            VALIDATE CONSTRAINT "command_outbox_command_id_fkey";
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM "command_events" e
        LEFT JOIN "commands" c ON c."id" = e."command_id"
        WHERE c."id" IS NULL
    ) THEN
        ALTER TABLE "command_events"
            VALIDATE CONSTRAINT "command_events_command_id_fkey";
    END IF;
END $$;


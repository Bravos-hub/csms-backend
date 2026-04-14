ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "mfa_required" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "passkey_credentials" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "credential_id" TEXT NOT NULL,
  "public_key" TEXT NOT NULL,
  "counter" INTEGER NOT NULL DEFAULT 0,
  "transports" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "aaguid" TEXT,
  "device_type" TEXT,
  "backed_up" BOOLEAN,
  "label" TEXT,
  "last_used_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "passkey_credentials_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "passkey_credentials_credential_id_key"
  ON "passkey_credentials"("credential_id");

CREATE INDEX IF NOT EXISTS "passkey_credentials_user_id_created_at_idx"
  ON "passkey_credentials"("user_id", "created_at");

CREATE INDEX IF NOT EXISTS "passkey_credentials_last_used_at_idx"
  ON "passkey_credentials"("last_used_at");

CREATE TABLE IF NOT EXISTS "mfa_challenges" (
  "id" TEXT NOT NULL,
  "user_id" TEXT,
  "challenge" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "relying_party_id" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "consumed_at" TIMESTAMP(3),
  "ip_address" TEXT,
  "user_agent" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "mfa_challenges_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "mfa_challenges_user_id_purpose_expires_at_idx"
  ON "mfa_challenges"("user_id", "purpose", "expires_at");

CREATE INDEX IF NOT EXISTS "mfa_challenges_expires_at_idx"
  ON "mfa_challenges"("expires_at");

CREATE INDEX IF NOT EXISTS "mfa_challenges_created_at_idx"
  ON "mfa_challenges"("created_at");

CREATE TABLE IF NOT EXISTS "mfa_recovery_codes" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "code_hash" TEXT NOT NULL,
  "used_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "mfa_recovery_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "mfa_recovery_codes_user_id_code_hash_key"
  ON "mfa_recovery_codes"("user_id", "code_hash");

CREATE INDEX IF NOT EXISTS "mfa_recovery_codes_user_id_used_at_idx"
  ON "mfa_recovery_codes"("user_id", "used_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'passkey_credentials_user_id_fkey'
  ) THEN
    ALTER TABLE "passkey_credentials"
      ADD CONSTRAINT "passkey_credentials_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mfa_challenges_user_id_fkey'
  ) THEN
    ALTER TABLE "mfa_challenges"
      ADD CONSTRAINT "mfa_challenges_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mfa_recovery_codes_user_id_fkey'
  ) THEN
    ALTER TABLE "mfa_recovery_codes"
      ADD CONSTRAINT "mfa_recovery_codes_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
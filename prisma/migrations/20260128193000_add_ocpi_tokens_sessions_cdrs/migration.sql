-- CreateTable
CREATE TABLE "ocpi_partner_tokens" (
    "id" TEXT NOT NULL,
    "country_code" VARCHAR(2) NOT NULL,
    "party_id" VARCHAR(3) NOT NULL,
    "token_uid" TEXT NOT NULL,
    "token_type" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '2.2.1',
    "data" JSONB NOT NULL,
    "last_updated" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ocpi_partner_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ocpi_tokens" (
    "id" TEXT NOT NULL,
    "country_code" VARCHAR(2) NOT NULL,
    "party_id" VARCHAR(3) NOT NULL,
    "token_uid" TEXT NOT NULL,
    "token_type" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "last_updated" TIMESTAMP(3) NOT NULL,
    "valid" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ocpi_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ocpi_partner_sessions" (
    "id" TEXT NOT NULL,
    "country_code" VARCHAR(2) NOT NULL,
    "party_id" VARCHAR(3) NOT NULL,
    "session_id" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '2.2.1',
    "data" JSONB NOT NULL,
    "last_updated" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ocpi_partner_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ocpi_partner_cdrs" (
    "id" TEXT NOT NULL,
    "country_code" VARCHAR(2) NOT NULL,
    "party_id" VARCHAR(3) NOT NULL,
    "cdr_id" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '2.2.1',
    "data" JSONB NOT NULL,
    "last_updated" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ocpi_partner_cdrs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ocpi_partner_tokens_country_code_party_id_token_uid_token_type_version_key" ON "ocpi_partner_tokens"("country_code", "party_id", "token_uid", "token_type", "version");

-- CreateIndex
CREATE INDEX "ocpi_partner_tokens_party_id_country_code_idx" ON "ocpi_partner_tokens"("party_id", "country_code");

-- CreateIndex
CREATE UNIQUE INDEX "ocpi_tokens_country_code_party_id_token_uid_token_type_key" ON "ocpi_tokens"("country_code", "party_id", "token_uid", "token_type");

-- CreateIndex
CREATE INDEX "ocpi_tokens_party_id_country_code_idx" ON "ocpi_tokens"("party_id", "country_code");

-- CreateIndex
CREATE UNIQUE INDEX "ocpi_partner_sessions_country_code_party_id_session_id_version_key" ON "ocpi_partner_sessions"("country_code", "party_id", "session_id", "version");

-- CreateIndex
CREATE INDEX "ocpi_partner_sessions_party_id_country_code_idx" ON "ocpi_partner_sessions"("party_id", "country_code");

-- CreateIndex
CREATE UNIQUE INDEX "ocpi_partner_cdrs_country_code_party_id_cdr_id_version_key" ON "ocpi_partner_cdrs"("country_code", "party_id", "cdr_id", "version");

-- CreateIndex
CREATE INDEX "ocpi_partner_cdrs_party_id_country_code_idx" ON "ocpi_partner_cdrs"("party_id", "country_code");

-- CreateTable
CREATE TABLE "ocpi_partners" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "party_id" VARCHAR(3) NOT NULL,
    "country_code" VARCHAR(2) NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "version" TEXT NOT NULL DEFAULT '2.2.1',
    "versions_url" TEXT,
    "token_a" TEXT,
    "token_b" TEXT,
    "token_c" TEXT,
    "roles" JSONB,
    "endpoints" JSONB,
    "last_sync_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ocpi_partners_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ocpi_partners_status_idx" ON "ocpi_partners"("status");

-- CreateIndex
CREATE INDEX "ocpi_partners_party_id_country_code_idx" ON "ocpi_partners"("party_id", "country_code");

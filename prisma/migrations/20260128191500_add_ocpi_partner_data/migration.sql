-- CreateTable
CREATE TABLE "ocpi_partner_locations" (
    "id" TEXT NOT NULL,
    "country_code" VARCHAR(2) NOT NULL,
    "party_id" VARCHAR(3) NOT NULL,
    "location_id" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '2.2.1',
    "data" JSONB NOT NULL,
    "last_updated" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ocpi_partner_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ocpi_partner_tariffs" (
    "id" TEXT NOT NULL,
    "country_code" VARCHAR(2) NOT NULL,
    "party_id" VARCHAR(3) NOT NULL,
    "tariff_id" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '2.2.1',
    "data" JSONB NOT NULL,
    "last_updated" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ocpi_partner_tariffs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ocpi_partner_locations_country_code_party_id_location_id_version_key" ON "ocpi_partner_locations"("country_code", "party_id", "location_id", "version");

-- CreateIndex
CREATE INDEX "ocpi_partner_locations_party_id_country_code_idx" ON "ocpi_partner_locations"("party_id", "country_code");

-- CreateIndex
CREATE UNIQUE INDEX "ocpi_partner_tariffs_country_code_party_id_tariff_id_version_key" ON "ocpi_partner_tariffs"("country_code", "party_id", "tariff_id", "version");

-- CreateIndex
CREATE INDEX "ocpi_partner_tariffs_party_id_country_code_idx" ON "ocpi_partner_tariffs"("party_id", "country_code");

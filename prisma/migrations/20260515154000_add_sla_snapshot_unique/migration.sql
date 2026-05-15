-- CreateIndex
CREATE UNIQUE INDEX "battery_provider_sla_snapshots_tenantId_providerId_periodStart_key" ON "battery_provider_sla_snapshots"("tenantId", "providerId", "periodStart");

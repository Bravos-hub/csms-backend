-- CreateTable
CREATE TABLE IF NOT EXISTS "tariff_calendars" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "siteId" TEXT,
  "name" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "timezone" TEXT NOT NULL DEFAULT 'UTC',
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "effectiveTo" TIMESTAMP(3),
  "bands" JSONB NOT NULL,
  "metadata" JSONB,
  "createdBy" TEXT,
  "approvedBy" TEXT,
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "tariff_calendars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "energy_optimization_plans" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "stationId" TEXT NOT NULL,
  "groupId" TEXT,
  "tariffCalendarId" TEXT,
  "state" TEXT NOT NULL DEFAULT 'DRAFT',
  "fallbackReason" TEXT,
  "windowStart" TIMESTAMP(3) NOT NULL,
  "windowEnd" TIMESTAMP(3) NOT NULL,
  "constraints" JSONB,
  "summary" JSONB,
  "schedule" JSONB,
  "diagnostics" JSONB,
  "createdBy" TEXT,
  "approvedBy" TEXT,
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "energy_optimization_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "energy_management_schedules" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "stationId" TEXT NOT NULL,
  "groupId" TEXT,
  "planId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "source" TEXT NOT NULL DEFAULT 'TARIFF_OPTIMIZER',
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "entries" JSONB NOT NULL,
  "fallbackToDlm" BOOLEAN NOT NULL DEFAULT false,
  "notes" TEXT,
  "approvedBy" TEXT,
  "approvedAt" TIMESTAMP(3),
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "energy_management_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "energy_plan_runs" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "planId" TEXT,
  "scheduleId" TEXT,
  "stationId" TEXT,
  "groupId" TEXT,
  "trigger" TEXT NOT NULL DEFAULT 'manual',
  "state" TEXT NOT NULL DEFAULT 'DRY_RUN',
  "message" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "metrics" JSONB,
  "output" JSONB,
  "initiatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "energy_plan_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "tariff_calendars_tenantId_siteId_name_version_key"
  ON "tariff_calendars"("tenantId", "siteId", "name", "version");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "tariff_calendars_tenantId_siteId_status_idx"
  ON "tariff_calendars"("tenantId", "siteId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "tariff_calendars_tenantId_updatedAt_idx"
  ON "tariff_calendars"("tenantId", "updatedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "energy_optimization_plans_tenantId_stationId_createdAt_idx"
  ON "energy_optimization_plans"("tenantId", "stationId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "energy_optimization_plans_tenantId_state_updatedAt_idx"
  ON "energy_optimization_plans"("tenantId", "state", "updatedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "energy_management_schedules_tenantId_stationId_status_idx"
  ON "energy_management_schedules"("tenantId", "stationId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "energy_management_schedules_tenantId_groupId_status_idx"
  ON "energy_management_schedules"("tenantId", "groupId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "energy_management_schedules_planId_idx"
  ON "energy_management_schedules"("planId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "energy_plan_runs_tenantId_stationId_startedAt_idx"
  ON "energy_plan_runs"("tenantId", "stationId", "startedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "energy_plan_runs_tenantId_state_startedAt_idx"
  ON "energy_plan_runs"("tenantId", "state", "startedAt");

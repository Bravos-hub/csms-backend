-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PayoutMethod') THEN
    CREATE TYPE "PayoutMethod" AS ENUM ('MOBILE_MONEY', 'BANK_TRANSFER', 'CASH_PICKUP');
  END IF;
END
$$;

-- AlterTable
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "lastStationAssignmentId" TEXT;
ALTER TABLE "user_invitations" ADD COLUMN IF NOT EXISTS "initialAssignmentsJson" JSONB;

-- CreateTable
CREATE TABLE IF NOT EXISTS "station_team_assignments" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "stationId" TEXT NOT NULL,
  "role" "UserRole" NOT NULL,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "assignedByUserId" TEXT,
  "attendantMode" "AttendantRoleMode",
  "shiftStart" TEXT,
  "shiftEnd" TEXT,
  "timezone" TEXT DEFAULT 'Africa/Kampala',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "station_team_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "staff_payout_profiles" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "method" "PayoutMethod" NOT NULL,
  "beneficiaryName" TEXT NOT NULL,
  "providerName" TEXT,
  "bankName" TEXT,
  "accountNumber" TEXT,
  "phoneNumber" TEXT,
  "currency" TEXT NOT NULL DEFAULT 'UGX',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "staff_payout_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "station_team_assignments_userId_isActive_idx" ON "station_team_assignments"("userId", "isActive");
CREATE INDEX IF NOT EXISTS "station_team_assignments_stationId_isActive_idx" ON "station_team_assignments"("stationId", "isActive");
CREATE INDEX IF NOT EXISTS "station_team_assignments_userId_stationId_isActive_idx" ON "station_team_assignments"("userId", "stationId", "isActive");
CREATE UNIQUE INDEX IF NOT EXISTS "staff_payout_profiles_userId_key" ON "staff_payout_profiles"("userId");
CREATE INDEX IF NOT EXISTS "staff_payout_profiles_isActive_idx" ON "staff_payout_profiles"("isActive");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'station_team_assignments_userId_fkey'
  ) THEN
    ALTER TABLE "station_team_assignments"
      ADD CONSTRAINT "station_team_assignments_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'station_team_assignments_stationId_fkey'
  ) THEN
    ALTER TABLE "station_team_assignments"
      ADD CONSTRAINT "station_team_assignments_stationId_fkey"
      FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'station_team_assignments_assignedByUserId_fkey'
  ) THEN
    ALTER TABLE "station_team_assignments"
      ADD CONSTRAINT "station_team_assignments_assignedByUserId_fkey"
      FOREIGN KEY ("assignedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'staff_payout_profiles_userId_fkey'
  ) THEN
    ALTER TABLE "staff_payout_profiles"
      ADD CONSTRAINT "staff_payout_profiles_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'staff_payout_profiles_createdByUserId_fkey'
  ) THEN
    ALTER TABLE "staff_payout_profiles"
      ADD CONSTRAINT "staff_payout_profiles_createdByUserId_fkey"
      FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'staff_payout_profiles_updatedByUserId_fkey'
  ) THEN
    ALTER TABLE "staff_payout_profiles"
      ADD CONSTRAINT "staff_payout_profiles_updatedByUserId_fkey"
      FOREIGN KEY ("updatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

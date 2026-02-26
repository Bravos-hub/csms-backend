DO $$
BEGIN
    CREATE TYPE "AttendantRoleMode" AS ENUM ('FIXED', 'MOBILE');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "bookings"
    ADD COLUMN IF NOT EXISTS "bookingType" TEXT NOT NULL DEFAULT 'advance',
    ADD COLUMN IF NOT EXISTS "customerNameSnapshot" TEXT,
    ADD COLUMN IF NOT EXISTS "customerRefSnapshot" TEXT,
    ADD COLUMN IF NOT EXISTS "vehicleModelSnapshot" TEXT,
    ADD COLUMN IF NOT EXISTS "vehiclePlateSnapshot" TEXT,
    ADD COLUMN IF NOT EXISTS "requiredKwh" DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS "feeAmount" DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS "feeCurrency" TEXT NOT NULL DEFAULT 'UGX',
    ADD COLUMN IF NOT EXISTS "autoCancelAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "autoCancelReason" TEXT,
    ADD COLUMN IF NOT EXISTS "historyLabel" TEXT;

CREATE TABLE IF NOT EXISTS "attendant_assignments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleMode" "AttendantRoleMode" NOT NULL,
    "stationId" TEXT NOT NULL,
    "shiftStart" TEXT NOT NULL,
    "shiftEnd" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Kampala',
    "statusOverride" TEXT,
    "activeFrom" TIMESTAMP(3),
    "activeTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendant_assignments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "attendant_assignment_requests" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "identifier" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "preferredStation" TEXT NOT NULL,
    "preferredShiftStart" TEXT NOT NULL,
    "preferredShiftEnd" TEXT NOT NULL,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "stationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendant_assignment_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "charging_receipt_transactions" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "bookingId" TEXT,
    "createdByUserId" TEXT,
    "source" TEXT NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "bookingRef" TEXT,
    "fromBooking" BOOLEAN NOT NULL DEFAULT false,
    "stationId" TEXT NOT NULL,
    "stationName" TEXT NOT NULL,
    "locationText" TEXT,
    "operator" TEXT,
    "vehicleModel" TEXT,
    "plate" TEXT,
    "customerName" TEXT,
    "connector" TEXT,
    "kwh" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "duration" TEXT,
    "rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxes" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "energyCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "charging_receipt_transactions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "attendant_notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetLabel" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendant_notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "attendant_assignments_userId_isActive_idx"
    ON "attendant_assignments" ("userId", "isActive");
CREATE INDEX IF NOT EXISTS "attendant_assignments_stationId_isActive_idx"
    ON "attendant_assignments" ("stationId", "isActive");
CREATE INDEX IF NOT EXISTS "attendant_assignments_activeFrom_activeTo_idx"
    ON "attendant_assignments" ("activeFrom", "activeTo");

CREATE INDEX IF NOT EXISTS "attendant_assignment_requests_identifier_idx"
    ON "attendant_assignment_requests" ("identifier");
CREATE INDEX IF NOT EXISTS "attendant_assignment_requests_userId_idx"
    ON "attendant_assignment_requests" ("userId");
CREATE INDEX IF NOT EXISTS "attendant_assignment_requests_orgId_status_idx"
    ON "attendant_assignment_requests" ("orgId", "status");
CREATE INDEX IF NOT EXISTS "attendant_assignment_requests_requestedAt_idx"
    ON "attendant_assignment_requests" ("requestedAt");

CREATE INDEX IF NOT EXISTS "charging_receipt_transactions_sessionId_idx"
    ON "charging_receipt_transactions" ("sessionId");
CREATE INDEX IF NOT EXISTS "charging_receipt_transactions_bookingId_idx"
    ON "charging_receipt_transactions" ("bookingId");
CREATE INDEX IF NOT EXISTS "charging_receipt_transactions_createdByUserId_idx"
    ON "charging_receipt_transactions" ("createdByUserId");
CREATE INDEX IF NOT EXISTS "charging_receipt_transactions_stationId_idx"
    ON "charging_receipt_transactions" ("stationId");
CREATE INDEX IF NOT EXISTS "charging_receipt_transactions_createdAt_idx"
    ON "charging_receipt_transactions" ("createdAt");

CREATE INDEX IF NOT EXISTS "attendant_notifications_userId_read_createdAt_idx"
    ON "attendant_notifications" ("userId", "read", "createdAt");
CREATE INDEX IF NOT EXISTS "attendant_notifications_type_createdAt_idx"
    ON "attendant_notifications" ("type", "createdAt");
CREATE INDEX IF NOT EXISTS "attendant_notifications_read_createdAt_idx"
    ON "attendant_notifications" ("read", "createdAt");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'attendant_assignments_userId_fkey'
    ) THEN
        ALTER TABLE "attendant_assignments"
            ADD CONSTRAINT "attendant_assignments_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'attendant_assignments_stationId_fkey'
    ) THEN
        ALTER TABLE "attendant_assignments"
            ADD CONSTRAINT "attendant_assignments_stationId_fkey"
            FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'attendant_assignment_requests_userId_fkey'
    ) THEN
        ALTER TABLE "attendant_assignment_requests"
            ADD CONSTRAINT "attendant_assignment_requests_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'attendant_assignment_requests_stationId_fkey'
    ) THEN
        ALTER TABLE "attendant_assignment_requests"
            ADD CONSTRAINT "attendant_assignment_requests_stationId_fkey"
            FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'charging_receipt_transactions_sessionId_fkey'
    ) THEN
        ALTER TABLE "charging_receipt_transactions"
            ADD CONSTRAINT "charging_receipt_transactions_sessionId_fkey"
            FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'charging_receipt_transactions_bookingId_fkey'
    ) THEN
        ALTER TABLE "charging_receipt_transactions"
            ADD CONSTRAINT "charging_receipt_transactions_bookingId_fkey"
            FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'charging_receipt_transactions_createdByUserId_fkey'
    ) THEN
        ALTER TABLE "charging_receipt_transactions"
            ADD CONSTRAINT "charging_receipt_transactions_createdByUserId_fkey"
            FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'attendant_notifications_userId_fkey'
    ) THEN
        ALTER TABLE "attendant_notifications"
            ADD CONSTRAINT "attendant_notifications_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

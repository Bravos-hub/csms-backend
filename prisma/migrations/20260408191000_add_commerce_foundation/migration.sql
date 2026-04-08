-- AlterTable
ALTER TABLE "wallets"
  ADD COLUMN IF NOT EXISTS "organizationId" TEXT,
  ADD COLUMN IF NOT EXISTS "isLocked" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "lockedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lockReason" TEXT;

-- AlterTable
ALTER TABLE "transactions"
  ADD COLUMN IF NOT EXISTS "paymentIntentId" TEXT,
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'POSTED',
  ADD COLUMN IF NOT EXISTS "reconciliationState" TEXT NOT NULL DEFAULT 'UNRECONCILED',
  ADD COLUMN IF NOT EXISTS "correlationId" TEXT,
  ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT,
  ADD COLUMN IF NOT EXISTS "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS "settlementStatus" TEXT NOT NULL DEFAULT 'RECONCILING',
  ADD COLUMN IF NOT EXISTS "correlationId" TEXT,
  ADD COLUMN IF NOT EXISTS "billingPeriodFrom" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "billingPeriodTo" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "paidAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "sourceSessionCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "invoices"
  ALTER COLUMN "status" SET DEFAULT 'ISSUED';

-- CreateTable
CREATE TABLE IF NOT EXISTS "payment_methods" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "organizationId" TEXT,
  "type" TEXT NOT NULL,
  "provider" TEXT,
  "label" TEXT NOT NULL,
  "tokenRef" TEXT NOT NULL,
  "last4" TEXT,
  "expiryMonth" INTEGER,
  "expiryYear" INTEGER,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "payment_intents" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "organizationId" TEXT,
  "walletId" TEXT,
  "paymentMethodId" TEXT,
  "invoiceId" TEXT,
  "sessionId" TEXT,
  "amount" DOUBLE PRECISION NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "idempotencyKey" TEXT NOT NULL,
  "correlationId" TEXT,
  "reconciliationState" TEXT NOT NULL DEFAULT 'UNRECONCILED',
  "checkoutUrl" TEXT,
  "checkoutQrPayload" TEXT,
  "providerReference" TEXT,
  "expiresAt" TIMESTAMP(3),
  "settledAt" TIMESTAMP(3),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "payment_intents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "payment_intents_idempotencyKey_key"
  ON "payment_intents"("idempotencyKey");

CREATE INDEX IF NOT EXISTS "wallets_organization_id_updated_at_idx"
  ON "wallets"("organizationId", "updatedAt");

CREATE INDEX IF NOT EXISTS "transactions_wallet_id_created_at_idx"
  ON "transactions"("walletId", "createdAt");

CREATE INDEX IF NOT EXISTS "transactions_correlation_id_idx"
  ON "transactions"("correlationId");

CREATE INDEX IF NOT EXISTS "transactions_idempotency_key_idx"
  ON "transactions"("idempotencyKey");

CREATE INDEX IF NOT EXISTS "transactions_reconciliation_state_created_at_idx"
  ON "transactions"("reconciliationState", "createdAt");

CREATE INDEX IF NOT EXISTS "transactions_status_created_at_idx"
  ON "transactions"("status", "createdAt");

CREATE INDEX IF NOT EXISTS "invoices_user_id_created_at_idx"
  ON "invoices"("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "invoices_status_due_date_idx"
  ON "invoices"("status", "dueDate");

CREATE INDEX IF NOT EXISTS "invoices_settlement_status_created_at_idx"
  ON "invoices"("settlementStatus", "createdAt");

CREATE INDEX IF NOT EXISTS "payment_methods_user_id_status_idx"
  ON "payment_methods"("userId", "status");

CREATE INDEX IF NOT EXISTS "payment_methods_organization_id_status_idx"
  ON "payment_methods"("organizationId", "status");

CREATE INDEX IF NOT EXISTS "payment_intents_organization_id_status_created_at_idx"
  ON "payment_intents"("organizationId", "status", "createdAt");

CREATE INDEX IF NOT EXISTS "payment_intents_user_id_status_created_at_idx"
  ON "payment_intents"("userId", "status", "createdAt");

CREATE INDEX IF NOT EXISTS "payment_intents_correlation_id_idx"
  ON "payment_intents"("correlationId");

CREATE INDEX IF NOT EXISTS "payment_intents_reconciliation_state_created_at_idx"
  ON "payment_intents"("reconciliationState", "createdAt");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'wallets_organizationId_fkey'
  ) THEN
    ALTER TABLE "wallets"
      ADD CONSTRAINT "wallets_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'payment_methods_userId_fkey'
  ) THEN
    ALTER TABLE "payment_methods"
      ADD CONSTRAINT "payment_methods_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'payment_methods_organizationId_fkey'
  ) THEN
    ALTER TABLE "payment_methods"
      ADD CONSTRAINT "payment_methods_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'payment_intents_userId_fkey'
  ) THEN
    ALTER TABLE "payment_intents"
      ADD CONSTRAINT "payment_intents_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'payment_intents_organizationId_fkey'
  ) THEN
    ALTER TABLE "payment_intents"
      ADD CONSTRAINT "payment_intents_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'payment_intents_walletId_fkey'
  ) THEN
    ALTER TABLE "payment_intents"
      ADD CONSTRAINT "payment_intents_walletId_fkey"
      FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'payment_intents_paymentMethodId_fkey'
  ) THEN
    ALTER TABLE "payment_intents"
      ADD CONSTRAINT "payment_intents_paymentMethodId_fkey"
      FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'payment_intents_invoiceId_fkey'
  ) THEN
    ALTER TABLE "payment_intents"
      ADD CONSTRAINT "payment_intents_invoiceId_fkey"
      FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'transactions_paymentIntentId_fkey'
  ) THEN
    ALTER TABLE "transactions"
      ADD CONSTRAINT "transactions_paymentIntentId_fkey"
      FOREIGN KEY ("paymentIntentId") REFERENCES "payment_intents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
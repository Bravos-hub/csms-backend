CREATE TYPE "MarketplaceContactEntityKind" AS ENUM ('SITE', 'OPERATOR', 'TECHNICIAN', 'PROVIDER');
CREATE TYPE "MarketplaceContactEventType" AS ENUM ('EMAIL', 'CALL', 'APPLY_SITE', 'REQUEST_PARTNERSHIP');

CREATE TABLE "marketplace_contact_events" (
  "id" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "entityKind" "MarketplaceContactEntityKind" NOT NULL,
  "entityId" TEXT NOT NULL,
  "eventType" "MarketplaceContactEventType" NOT NULL,
  "entityName" TEXT,
  "entityCity" TEXT,
  "entityRegion" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "marketplace_contact_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "marketplace_contact_events_actorId_createdAt_idx"
  ON "marketplace_contact_events"("actorId", "createdAt");

CREATE INDEX "marketplace_contact_events_actorId_entityKind_entityId_createdAt_idx"
  ON "marketplace_contact_events"("actorId", "entityKind", "entityId", "createdAt");

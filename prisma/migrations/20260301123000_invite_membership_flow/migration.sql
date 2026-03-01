DO $$
BEGIN
    CREATE TYPE "MembershipStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'REVOKED');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'ACTIVATED', 'EXPIRED', 'REVOKED');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "users"
    ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "organization_memberships" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "ownerCapability" "StationOwnerCapability",
    "status" "MembershipStatus" NOT NULL DEFAULT 'INVITED',
    "invitedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_memberships_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "organization_memberships_userId_organizationId_key" UNIQUE ("userId", "organizationId")
);

CREATE TABLE IF NOT EXISTS "user_invitations" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "userId" TEXT,
    "organizationId" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "ownerCapability" "StationOwnerCapability",
    "invitedBy" TEXT,
    "tokenHash" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "tempPasswordHash" TEXT,
    "tempPasswordIssuedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_invitations_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'organization_memberships_userId_fkey'
    ) THEN
        ALTER TABLE "organization_memberships"
            ADD CONSTRAINT "organization_memberships_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'organization_memberships_organizationId_fkey'
    ) THEN
        ALTER TABLE "organization_memberships"
            ADD CONSTRAINT "organization_memberships_organizationId_fkey"
            FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'user_invitations_userId_fkey'
    ) THEN
        ALTER TABLE "user_invitations"
            ADD CONSTRAINT "user_invitations_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'user_invitations_organizationId_fkey'
    ) THEN
        ALTER TABLE "user_invitations"
            ADD CONSTRAINT "user_invitations_organizationId_fkey"
            FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "user_invitations_tokenHash_key"
    ON "user_invitations" ("tokenHash");
CREATE UNIQUE INDEX IF NOT EXISTS "organization_memberships_userId_organizationId_key"
    ON "organization_memberships" ("userId", "organizationId");
CREATE INDEX IF NOT EXISTS "organization_memberships_organizationId_status_idx"
    ON "organization_memberships" ("organizationId", "status");
CREATE INDEX IF NOT EXISTS "organization_memberships_userId_status_idx"
    ON "organization_memberships" ("userId", "status");
CREATE INDEX IF NOT EXISTS "user_invitations_email_organizationId_status_idx"
    ON "user_invitations" ("email", "organizationId", "status");
CREATE INDEX IF NOT EXISTS "user_invitations_organizationId_status_idx"
    ON "user_invitations" ("organizationId", "status");
CREATE INDEX IF NOT EXISTS "user_invitations_expiresAt_idx"
    ON "user_invitations" ("expiresAt");

INSERT INTO "organization_memberships" (
    "id",
    "userId",
    "organizationId",
    "role",
    "ownerCapability",
    "status",
    "createdAt",
    "updatedAt"
)
SELECT
    'backfill-' || u."id" || '-' || u."organizationId" AS "id",
    u."id" AS "userId",
    u."organizationId" AS "organizationId",
    u."role" AS "role",
    u."ownerCapability" AS "ownerCapability",
    'ACTIVE'::"MembershipStatus" AS "status",
    CURRENT_TIMESTAMP AS "createdAt",
    CURRENT_TIMESTAMP AS "updatedAt"
FROM "users" u
WHERE u."organizationId" IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM "organization_memberships" m
      WHERE m."userId" = u."id"
        AND m."organizationId" = u."organizationId"
  );

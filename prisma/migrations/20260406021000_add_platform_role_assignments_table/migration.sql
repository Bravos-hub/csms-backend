CREATE TABLE IF NOT EXISTS "platform_role_assignments" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "roleKey" "CanonicalRoleKey" NOT NULL,
  "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
  "assignedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "platform_role_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "platform_role_assignments_userId_roleKey_key"
  ON "platform_role_assignments" ("userId", "roleKey");

CREATE INDEX IF NOT EXISTS "platform_role_assignments_userId_status_idx"
  ON "platform_role_assignments" ("userId", "status");

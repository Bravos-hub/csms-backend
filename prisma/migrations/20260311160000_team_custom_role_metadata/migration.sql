ALTER TABLE "organization_memberships"
    ADD COLUMN IF NOT EXISTS "customRoleId" TEXT,
    ADD COLUMN IF NOT EXISTS "customRoleName" TEXT;

ALTER TABLE "user_invitations"
    ADD COLUMN IF NOT EXISTS "customRoleId" TEXT,
    ADD COLUMN IF NOT EXISTS "customRoleName" TEXT;

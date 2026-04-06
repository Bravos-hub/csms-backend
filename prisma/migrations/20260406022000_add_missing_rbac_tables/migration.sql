DO $$
BEGIN
  CREATE TYPE "PermissionScope" AS ENUM ('PLATFORM', 'TENANT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TYPE "PermissionScope" ADD VALUE IF NOT EXISTS 'PLATFORM';
ALTER TYPE "PermissionScope" ADD VALUE IF NOT EXISTS 'TENANT';

DO $$
BEGIN
  CREATE TYPE "CustomRoleStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUSPENDED', 'ARCHIVED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TYPE "CustomRoleStatus" ADD VALUE IF NOT EXISTS 'DRAFT';
ALTER TYPE "CustomRoleStatus" ADD VALUE IF NOT EXISTS 'ACTIVE';
ALTER TYPE "CustomRoleStatus" ADD VALUE IF NOT EXISTS 'SUSPENDED';
ALTER TYPE "CustomRoleStatus" ADD VALUE IF NOT EXISTS 'ARCHIVED';

CREATE TABLE IF NOT EXISTS "permission_definitions" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "description" TEXT,
  "scope" "PermissionScope" NOT NULL,
  "resource" TEXT,
  "action" TEXT,
  "isSystem" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "permission_definitions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "permission_definitions_code_key"
  ON "permission_definitions" ("code");

CREATE INDEX IF NOT EXISTS "permission_definitions_scope_idx"
  ON "permission_definitions" ("scope");

CREATE TABLE IF NOT EXISTS "system_role_templates" (
  "id" TEXT NOT NULL,
  "key" "CanonicalRoleKey" NOT NULL,
  "label" TEXT NOT NULL,
  "description" TEXT,
  "family" TEXT NOT NULL,
  "scope" "PermissionScope" NOT NULL,
  "isPlatformRole" BOOLEAN NOT NULL DEFAULT false,
  "customizable" BOOLEAN NOT NULL DEFAULT false,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "system_role_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "system_role_templates_key_key"
  ON "system_role_templates" ("key");

CREATE TABLE IF NOT EXISTS "system_role_template_permissions" (
  "id" TEXT NOT NULL,
  "roleTemplateId" TEXT NOT NULL,
  "permissionId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "system_role_template_permissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "system_role_template_permissions_roleTemplateId_permissionId_key"
  ON "system_role_template_permissions" ("roleTemplateId", "permissionId");

CREATE INDEX IF NOT EXISTS "system_role_template_permissions_permissionId_idx"
  ON "system_role_template_permissions" ("permissionId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'system_role_template_permissions_roleTemplateId_fkey'
  ) THEN
    ALTER TABLE "system_role_template_permissions"
      ADD CONSTRAINT "system_role_template_permissions_roleTemplateId_fkey"
      FOREIGN KEY ("roleTemplateId") REFERENCES "system_role_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'system_role_template_permissions_permissionId_fkey'
  ) THEN
    ALTER TABLE "system_role_template_permissions"
      ADD CONSTRAINT "system_role_template_permissions_permissionId_fkey"
      FOREIGN KEY ("permissionId") REFERENCES "permission_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "tenant_custom_roles" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "baseRoleKey" "CanonicalRoleKey" NOT NULL,
  "status" "CustomRoleStatus" NOT NULL DEFAULT 'DRAFT',
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "tenant_custom_roles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "tenant_custom_roles_organizationId_key_key"
  ON "tenant_custom_roles" ("organizationId", "key");

CREATE INDEX IF NOT EXISTS "tenant_custom_roles_organizationId_status_idx"
  ON "tenant_custom_roles" ("organizationId", "status");

CREATE INDEX IF NOT EXISTS "tenant_custom_roles_organizationId_baseRoleKey_idx"
  ON "tenant_custom_roles" ("organizationId", "baseRoleKey");

CREATE TABLE IF NOT EXISTS "tenant_custom_role_permissions" (
  "id" TEXT NOT NULL,
  "customRoleId" TEXT NOT NULL,
  "permissionCode" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "tenant_custom_role_permissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "tenant_custom_role_permissions_customRoleId_permissionCode_key"
  ON "tenant_custom_role_permissions" ("customRoleId", "permissionCode");

CREATE INDEX IF NOT EXISTS "tenant_custom_role_permissions_permissionCode_idx"
  ON "tenant_custom_role_permissions" ("permissionCode");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tenant_custom_role_permissions_customRoleId_fkey'
  ) THEN
    ALTER TABLE "tenant_custom_role_permissions"
      ADD CONSTRAINT "tenant_custom_role_permissions_customRoleId_fkey"
      FOREIGN KEY ("customRoleId") REFERENCES "tenant_custom_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "tenant_memberships" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "roleKey" "CanonicalRoleKey" NOT NULL,
  "customRoleId" TEXT,
  "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
  "siteIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "stationIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "fleetGroupIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "tenant_memberships_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "tenant_memberships_userId_organizationId_key"
  ON "tenant_memberships" ("userId", "organizationId");

CREATE INDEX IF NOT EXISTS "tenant_memberships_organizationId_status_idx"
  ON "tenant_memberships" ("organizationId", "status");

CREATE INDEX IF NOT EXISTS "tenant_memberships_organizationId_roleKey_idx"
  ON "tenant_memberships" ("organizationId", "roleKey");

/*
  Warnings:

  - You are about to drop the column `planEndDate` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `planStartDate` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `planStatus` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `subscribedPlanId` on the `users` table. All the data in the column will be lost.
  - You are about to drop the `permission_definitions` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `plan_features` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `plan_permissions` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `subscription_plans` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "plan_features" DROP CONSTRAINT "plan_features_planId_fkey";

-- DropForeignKey
ALTER TABLE "plan_permissions" DROP CONSTRAINT "plan_permissions_planId_fkey";

-- DropForeignKey
ALTER TABLE "users" DROP CONSTRAINT "users_subscribedPlanId_fkey";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "planEndDate",
DROP COLUMN "planStartDate",
DROP COLUMN "planStatus",
DROP COLUMN "subscribedPlanId";

-- DropTable
DROP TABLE "permission_definitions";

-- DropTable
DROP TABLE "plan_features";

-- DropTable
DROP TABLE "plan_permissions";

-- DropTable
DROP TABLE "subscription_plans";

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor" TEXT NOT NULL,
    "actor_name" TEXT,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "resource_id" TEXT,
    "details" JSONB,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SUCCESS',
    "error_message" TEXT,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs"("actor");

-- CreateIndex
CREATE INDEX "audit_logs_timestamp_idx" ON "audit_logs"("timestamp");

-- CreateIndex
CREATE INDEX "audit_logs_resource_idx" ON "audit_logs"("resource");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_status_idx" ON "audit_logs"("status");

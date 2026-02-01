-- AlterTable
ALTER TABLE "plan_features" ADD COLUMN     "order" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "subscription_plans" ADD COLUMN     "isPopular" BOOLEAN NOT NULL DEFAULT false;

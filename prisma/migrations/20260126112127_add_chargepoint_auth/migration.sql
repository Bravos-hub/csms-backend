-- AlterTable
ALTER TABLE "charge_points" ADD COLUMN     "allowedInsecure" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "clientSecretHash" TEXT,
ADD COLUMN     "clientSecretSalt" TEXT;

-- CreateTable
CREATE TABLE "commands" (
    "id" TEXT NOT NULL,
    "station_id" TEXT,
    "charge_point_id" TEXT,
    "connector_id" TEXT,
    "command_type" TEXT NOT NULL,
    "payload" JSONB,
    "status" TEXT NOT NULL,
    "requested_by" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL,
    "sent_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "correlation_id" TEXT,
    "error" TEXT,

    CONSTRAINT "commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "command_outbox" (
    "id" TEXT NOT NULL,
    "command_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_at" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "command_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "command_events" (
    "id" TEXT NOT NULL,
    "command_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "payload" JSONB,
    "occurred_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "command_events_pkey" PRIMARY KEY ("id")
);

/*
  Warnings:

  - The `designation` column on the `Admin` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "Designation" AS ENUM ('Finance', 'CSM', 'BD', 'Growth');

-- AlterTable
ALTER TABLE "Admin" DROP COLUMN "designation",
ADD COLUMN     "designation" "Designation";

-- CreateTable
CREATE TABLE "MediaKit" (
    "id" TEXT NOT NULL,
    "photoUrl" TEXT,
    "name" TEXT,
    "about" TEXT,
    "creatorId" TEXT NOT NULL,

    CONSTRAINT "MediaKit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Timeline" (
    "id" TEXT NOT NULL,
    "task_name" TEXT,
    "start_date" TIMESTAMP(3),
    "end_data" TIMESTAMP(3),
    "campaignId" TEXT,

    CONSTRAINT "Timeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignTimeline" (
    "id" TEXT NOT NULL,
    "timelineId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,

    CONSTRAINT "CampaignTimeline_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MediaKit_id_key" ON "MediaKit"("id");

-- CreateIndex
CREATE UNIQUE INDEX "MediaKit_creatorId_key" ON "MediaKit"("creatorId");

-- CreateIndex
CREATE UNIQUE INDEX "Timeline_id_key" ON "Timeline"("id");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignTimeline_id_key" ON "CampaignTimeline"("id");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignTimeline_timelineId_key" ON "CampaignTimeline"("timelineId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignTimeline_campaignId_key" ON "CampaignTimeline"("campaignId");

-- AddForeignKey
ALTER TABLE "MediaKit" ADD CONSTRAINT "MediaKit_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Timeline" ADD CONSTRAINT "Timeline_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignTimeline" ADD CONSTRAINT "CampaignTimeline_timelineId_fkey" FOREIGN KEY ("timelineId") REFERENCES "Timeline"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignTimeline" ADD CONSTRAINT "CampaignTimeline_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

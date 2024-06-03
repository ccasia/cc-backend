/*
  Warnings:

  - The `designation` column on the `Admin` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the column `companyId` on the `Campaign` table. All the data in the column will be lost.
  - You are about to drop the column `campaignId` on the `Timeline` table. All the data in the column will be lost.
  - You are about to drop the column `end_data` on the `Timeline` table. All the data in the column will be lost.
  - You are about to drop the `CampaignRequirnment` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Campaign" DROP CONSTRAINT "Campaign_companyId_fkey";

-- DropForeignKey
ALTER TABLE "Campaign" DROP CONSTRAINT "Campaign_userId_fkey";

-- DropForeignKey
ALTER TABLE "CampaignRequirnment" DROP CONSTRAINT "CampaignRequirnment_campaignId_fkey";

-- DropForeignKey
ALTER TABLE "Timeline" DROP CONSTRAINT "Timeline_campaignId_fkey";

-- DropIndex
DROP INDEX "CampaignTimeline_campaignId_key";

-- DropIndex
DROP INDEX "CampaignTimeline_timelineId_key";

-- AlterTable
ALTER TABLE "Admin" DROP COLUMN "designation",
ADD COLUMN     "designation" TEXT;

-- AlterTable
ALTER TABLE "Campaign" DROP COLUMN "companyId";

-- AlterTable
ALTER TABLE "Timeline" DROP COLUMN "campaignId",
DROP COLUMN "end_data",
ADD COLUMN     "end_date" TIMESTAMP(3);

-- DropTable
DROP TABLE "CampaignRequirnment";

-- CreateTable
CREATE TABLE "CampaignRequirement" (
    "id" TEXT NOT NULL,
    "gender" VARCHAR(255) NOT NULL,
    "age" VARCHAR(255) NOT NULL,
    "geoLocation" VARCHAR(255) NOT NULL,
    "language" JSONB,
    "creator_persona" VARCHAR(255) NOT NULL,
    "user_persona" VARCHAR(255) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "campaignId" TEXT NOT NULL,

    CONSTRAINT "CampaignRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CampaignRequirement_id_key" ON "CampaignRequirement"("id");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignRequirement_campaignId_key" ON "CampaignRequirement"("campaignId");

-- CreateIndex
CREATE INDEX "CampaignTimeline_timelineId_campaignId_idx" ON "CampaignTimeline"("timelineId", "campaignId");

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRequirement" ADD CONSTRAINT "CampaignRequirement_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

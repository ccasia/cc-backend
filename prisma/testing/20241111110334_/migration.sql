/*
  Warnings:

  - A unique constraint covering the columns `[userId,campaignId]` on the table `BookMarkCampaign` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
ALTER TYPE "Entity" ADD VALUE 'Status';

-- DropIndex
DROP INDEX "BookMarkCampaign_campaignId_key";

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "sheetId" TEXT;

-- AlterTable
ALTER TABLE "CampaignBrief" ALTER COLUMN "industries" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "threadId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "BookMarkCampaign_userId_campaignId_key" ON "BookMarkCampaign"("userId", "campaignId");

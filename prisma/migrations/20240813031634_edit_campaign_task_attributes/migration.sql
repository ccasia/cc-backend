/*
  Warnings:

  - You are about to drop the column `endDate` on the `CampaignTask` table. All the data in the column will be lost.
  - You are about to drop the column `startDate` on the `CampaignTask` table. All the data in the column will be lost.
  - You are about to drop the column `submissionId` on the `CampaignTask` table. All the data in the column will be lost.
  - You are about to drop the `FinalDraft` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `FirstDraft` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[userId,campaignId,campaignTimelineId]` on the table `CampaignTask` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "CampaignTask" DROP COLUMN "endDate",
DROP COLUMN "startDate",
DROP COLUMN "submissionId",
ADD COLUMN     "dueDate" TIMESTAMP(3);

-- DropTable
DROP TABLE "FinalDraft";

-- DropTable
DROP TABLE "FirstDraft";

-- CreateIndex
CREATE UNIQUE INDEX "CampaignTask_userId_campaignId_campaignTimelineId_key" ON "CampaignTask"("userId", "campaignId", "campaignTimelineId");

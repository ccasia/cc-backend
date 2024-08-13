/*
  Warnings:

  - You are about to drop the column `priority` on the `CampaignTask` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `CampaignTask` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "CampaignTask" DROP CONSTRAINT "CampaignTask_userId_fkey";

-- DropIndex
DROP INDEX "CampaignTask_userId_campaignId_campaignTimelineId_key";

-- AlterTable
ALTER TABLE "CampaignTask" DROP COLUMN "priority",
DROP COLUMN "userId";

-- CreateTable
CREATE TABLE "CampaignTaskAdmin" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "campaignTaskId" TEXT NOT NULL,

    CONSTRAINT "CampaignTaskAdmin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CampaignTaskAdmin_userId_campaignTaskId_key" ON "CampaignTaskAdmin"("userId", "campaignTaskId");

-- AddForeignKey
ALTER TABLE "CampaignTaskAdmin" ADD CONSTRAINT "CampaignTaskAdmin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignTaskAdmin" ADD CONSTRAINT "CampaignTaskAdmin_campaignTaskId_fkey" FOREIGN KEY ("campaignTaskId") REFERENCES "CampaignTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

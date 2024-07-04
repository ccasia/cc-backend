/*
  Warnings:

  - You are about to drop the column `firstName` on the `Creator` table. All the data in the column will be lost.
  - You are about to drop the column `lastName` on the `Creator` table. All the data in the column will be lost.
  - You are about to drop the `CampaignTimeline` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Timeline` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `adminId` to the `Campaign` table without a default value. This is not possible if the table is not empty.
  - Added the required column `description` to the `Campaign` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Campaign" DROP CONSTRAINT "Campaign_brandId_fkey";

-- DropForeignKey
ALTER TABLE "CampaignTimeline" DROP CONSTRAINT "CampaignTimeline_campaignId_fkey";

-- DropForeignKey
ALTER TABLE "CampaignTimeline" DROP CONSTRAINT "CampaignTimeline_timelineId_fkey";

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "adminId" TEXT NOT NULL,
ADD COLUMN     "companyId" TEXT,
ADD COLUMN     "description" TEXT NOT NULL,
ALTER COLUMN "brandId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "CampaignBrief" ALTER COLUMN "objectives" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Creator" DROP COLUMN "firstName",
DROP COLUMN "lastName";

-- DropTable
DROP TABLE "CampaignTimeline";

-- DropTable
DROP TABLE "Timeline";

-- CreateTable
CREATE TABLE "CampaignAdmin" (
    "adminId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,

    CONSTRAINT "CampaignAdmin_pkey" PRIMARY KEY ("adminId","campaignId")
);

-- CreateIndex
CREATE INDEX "CampaignAdmin_adminId_idx" ON "CampaignAdmin"("adminId");

-- CreateIndex
CREATE INDEX "CampaignAdmin_campaignId_idx" ON "CampaignAdmin"("campaignId");

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignAdmin" ADD CONSTRAINT "CampaignAdmin_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignAdmin" ADD CONSTRAINT "CampaignAdmin_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

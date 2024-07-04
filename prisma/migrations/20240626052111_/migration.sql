/*
  Warnings:

  - The `gender` column on the `CampaignRequirement` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `age` column on the `CampaignRequirement` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `geoLocation` column on the `CampaignRequirement` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `language` column on the `CampaignRequirement` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `creator_persona` column on the `CampaignRequirement` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the column `firstName` on the `Creator` table. All the data in the column will be lost.
  - You are about to drop the column `lastName` on the `Creator` table. All the data in the column will be lost.
  - You are about to drop the `CampaignTimeline` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Timeline` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `description` to the `Campaign` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "PitchType" AS ENUM ('video', 'text');

-- CreateEnum
CREATE TYPE "PitchStatus" AS ENUM ('accept', 'reject');

-- DropForeignKey
ALTER TABLE "Campaign" DROP CONSTRAINT "Campaign_brandId_fkey";

-- DropForeignKey
ALTER TABLE "CampaignTimeline" DROP CONSTRAINT "CampaignTimeline_campaignId_fkey";

-- DropForeignKey
ALTER TABLE "CampaignTimeline" DROP CONSTRAINT "CampaignTimeline_timelineId_fkey";

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "companyId" TEXT,
ADD COLUMN     "description" TEXT NOT NULL,
ALTER COLUMN "brandId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "CampaignBrief" ALTER COLUMN "objectives" DROP NOT NULL;

-- AlterTable
ALTER TABLE "CampaignRequirement" DROP COLUMN "gender",
ADD COLUMN     "gender" TEXT[],
DROP COLUMN "age",
ADD COLUMN     "age" TEXT[],
DROP COLUMN "geoLocation",
ADD COLUMN     "geoLocation" TEXT[],
DROP COLUMN "language",
ADD COLUMN     "language" TEXT[],
DROP COLUMN "creator_persona",
ADD COLUMN     "creator_persona" TEXT[];

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

-- CreateTable
CREATE TABLE "Pitch" (
    "id" TEXT NOT NULL,
    "type" "PitchType" NOT NULL,
    "campaignId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "PitchStatus",
    "content" TEXT NOT NULL DEFAULT 'test',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Pitch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShortListedCreator" (
    "id" TEXT NOT NULL,
    "shortlisted_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creatorId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,

    CONSTRAINT "ShortListedCreator_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CampaignAdmin_adminId_idx" ON "CampaignAdmin"("adminId");

-- CreateIndex
CREATE INDEX "CampaignAdmin_campaignId_idx" ON "CampaignAdmin"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "Pitch_id_key" ON "Pitch"("id");

-- CreateIndex
CREATE UNIQUE INDEX "ShortListedCreator_id_key" ON "ShortListedCreator"("id");

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignAdmin" ADD CONSTRAINT "CampaignAdmin_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignAdmin" ADD CONSTRAINT "CampaignAdmin_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pitch" ADD CONSTRAINT "Pitch_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pitch" ADD CONSTRAINT "Pitch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShortListedCreator" ADD CONSTRAINT "ShortListedCreator_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShortListedCreator" ADD CONSTRAINT "ShortListedCreator_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

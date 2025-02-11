/*
  Warnings:

  - You are about to drop the column `sheetId` on the `Campaign` table. All the data in the column will be lost.
  - You are about to alter the column `registration_number` on the `Company` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(150)`.
  - You are about to drop the column `createdBy` on the `Invoice` table. All the data in the column will be lost.
  - You are about to drop the column `interests` on the `MediaKit` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `MediaKit` table. All the data in the column will be lost.
  - You are about to drop the column `photoUrl` on the `MediaKit` table. All the data in the column will be lost.
  - You are about to drop the `AdminSignature` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `CampaignTaskDependency` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `session` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[invoiceNumber]` on the table `Invoice` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "VideoStatus" AS ENUM ('Uploaded', 'Processing', 'Published', 'Rejected');

-- AlterEnum
ALTER TYPE "Mode" ADD VALUE 'advanced';

-- DropForeignKey
ALTER TABLE "AdminSignature" DROP CONSTRAINT "AdminSignature_userId_fkey";

-- DropForeignKey
ALTER TABLE "CampaignAdmin" DROP CONSTRAINT "CampaignAdmin_adminId_fkey";

-- DropForeignKey
ALTER TABLE "CampaignTaskDependency" DROP CONSTRAINT "CampaignTaskDependency_campaignTaskId_fkey";

-- DropForeignKey
ALTER TABLE "CampaignTaskDependency" DROP CONSTRAINT "CampaignTaskDependency_dependsOnCampaignTaskId_fkey";

-- DropForeignKey
ALTER TABLE "Feedback" DROP CONSTRAINT "Feedback_submissionId_fkey";

-- DropForeignKey
ALTER TABLE "Invoice" DROP CONSTRAINT "Invoice_createdBy_fkey";

-- DropForeignKey
ALTER TABLE "SeenMessage" DROP CONSTRAINT "SeenMessage_messageId_fkey";

-- DropForeignKey
ALTER TABLE "Task" DROP CONSTRAINT "Task_submissionId_fkey";

-- DropForeignKey
ALTER TABLE "UnreadMessage" DROP CONSTRAINT "UnreadMessage_messageId_fkey";

-- DropIndex
DROP INDEX "AgreementTemplate_userId_key";

-- DropIndex
DROP INDEX "Company_registration_number_key";

-- DropIndex
DROP INDEX "Task_submissionId_key";

-- AlterTable
ALTER TABLE "AgreementTemplate" ADD COLUMN     "isDefault" BOOLEAN DEFAULT false;

-- AlterTable
ALTER TABLE "Campaign" DROP COLUMN "sheetId",
ADD COLUMN     "agreementTemplateId" TEXT,
ADD COLUMN     "campaignType" TEXT DEFAULT 'normal',
ADD COLUMN     "rawFootage" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "spreadSheetURL" TEXT;

-- AlterTable
ALTER TABLE "CampaignBrief" ADD COLUMN     "otherAttachments" TEXT[],
ADD COLUMN     "referencesLinks" TEXT[],
ALTER COLUMN "title" SET DATA TYPE TEXT,
ALTER COLUMN "objectives" SET DATA TYPE TEXT,
ALTER COLUMN "agreementFrom" DROP NOT NULL,
ALTER COLUMN "agreementFrom" SET DATA TYPE TEXT,
ALTER COLUMN "success" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "CampaignRequirement" ALTER COLUMN "user_persona" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "Company" ALTER COLUMN "registration_number" SET DATA TYPE VARCHAR(150);

-- AlterTable
ALTER TABLE "Creator" ADD COLUMN     "allowToChange" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "socialMediaUpdateCount" JSONB;

-- AlterTable
ALTER TABLE "Invoice" DROP COLUMN "createdBy",
ADD COLUMN     "adminId" TEXT;

-- AlterTable
ALTER TABLE "MediaKit" DROP COLUMN "interests",
DROP COLUMN "name",
DROP COLUMN "photoUrl",
ADD COLUMN     "displayName" TEXT;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "file" TEXT,
ADD COLUMN     "fileType" TEXT;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "invoiceId" TEXT;

-- AlterTable
ALTER TABLE "PaymentForm" ALTER COLUMN "icNumber" DROP NOT NULL,
ALTER COLUMN "bankName" DROP NOT NULL,
ALTER COLUMN "bankAccountNumber" DROP NOT NULL,
ALTER COLUMN "bankAccountName" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Submission" ADD COLUMN     "rawFootages" TEXT[],
ADD COLUMN     "videos" TEXT[];

-- AlterTable
ALTER TABLE "_RolePermission" ADD CONSTRAINT "_RolePermission_AB_pkey" PRIMARY KEY ("A", "B");

-- DropIndex
DROP INDEX "_RolePermission_AB_unique";

-- AlterTable
ALTER TABLE "_UserThreads" ADD CONSTRAINT "_UserThreads_AB_pkey" PRIMARY KEY ("A", "B");

-- DropIndex
DROP INDEX "_UserThreads_AB_unique";

-- DropTable
DROP TABLE "AdminSignature";

-- DropTable
DROP TABLE "CampaignTaskDependency";

-- DropTable
DROP TABLE "session";

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sid" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Video" (
    "id" TEXT NOT NULL,
    "url" TEXT,
    "status" "VideoStatus" NOT NULL DEFAULT 'Uploaded',
    "submissionId" TEXT,

    CONSTRAINT "Video_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bugs" (
    "id" TEXT NOT NULL,
    "stepsToReproduce" TEXT NOT NULL,
    "attachment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,

    CONSTRAINT "Bugs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Session_sid_key" ON "Session"("sid");

-- CreateIndex
CREATE UNIQUE INDEX "Bugs_id_key" ON "Bugs"("id");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");

-- AddForeignKey
ALTER TABLE "UnreadMessage" ADD CONSTRAINT "UnreadMessage_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeenMessage" ADD CONSTRAINT "SeenMessage_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_agreementTemplateId_fkey" FOREIGN KEY ("agreementTemplateId") REFERENCES "AgreementTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignAdmin" ADD CONSTRAINT "CampaignAdmin_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bugs" ADD CONSTRAINT "Bugs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

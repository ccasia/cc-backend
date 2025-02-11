/*
  Warnings:

  - You are about to drop the column `packageId` on the `Brand` table. All the data in the column will be lost.
  - You are about to drop the column `availableCredits` on the `Packages` table. All the data in the column will be lost.
  - You are about to drop the column `creditsUtilized` on the `Packages` table. All the data in the column will be lost.
  - You are about to drop the column `currency` on the `Packages` table. All the data in the column will be lost.
  - You are about to drop the column `value` on the `Packages` table. All the data in the column will be lost.
  - You are about to drop the column `currency` on the `PackagesClient` table. All the data in the column will be lost.
  - You are about to drop the column `value` on the `PackagesClient` table. All the data in the column will be lost.
  - You are about to drop the column `rawFootages` on the `Submission` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[campaignId]` on the table `Campaign` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[clientId]` on the table `Company` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[packageId]` on the table `PackagesClient` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `valueMYR` to the `Packages` table without a default value. This is not possible if the table is not empty.
  - Added the required column `valueSGD` to the `Packages` table without a default value. This is not possible if the table is not empty.
  - The required column `companyId` was added to the `PackagesClient` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.
  - Added the required column `packageId` to the `PackagesClient` table without a default value. This is not possible if the table is not empty.
  - Added the required column `valueMYR` to the `PackagesClient` table without a default value. This is not possible if the table is not empty.
  - Added the required column `valueSGD` to the `PackagesClient` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "CompanyType" AS ENUM ('agency', 'directClient');

-- AlterEnum
ALTER TYPE "PackageType" ADD VALUE 'Pro';

-- DropForeignKey
ALTER TABLE "Brand" DROP CONSTRAINT "Brand_packageId_fkey";

-- DropIndex
DROP INDEX "Brand_packageId_key";

-- AlterTable
ALTER TABLE "Brand" DROP COLUMN "packageId";

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "campaignCredits" INTEGER,
ADD COLUMN     "campaignId" TEXT,
ADD COLUMN     "photos" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "clientId" TEXT,
ADD COLUMN     "type" "CompanyType";

-- AlterTable
ALTER TABLE "Packages" DROP COLUMN "availableCredits",
DROP COLUMN "creditsUtilized",
DROP COLUMN "currency",
DROP COLUMN "value",
ADD COLUMN     "valueMYR" INTEGER NOT NULL,
ADD COLUMN     "valueSGD" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "PackagesClient" DROP COLUMN "currency",
DROP COLUMN "value",
ADD COLUMN     "companyId" TEXT NOT NULL,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "expiryDate" TIMESTAMP(3),
ADD COLUMN     "packageId" TEXT NOT NULL,
ADD COLUMN     "valueMYR" INTEGER NOT NULL,
ADD COLUMN     "valueSGD" INTEGER NOT NULL,
ALTER COLUMN "creditsUtilized" DROP NOT NULL,
ALTER COLUMN "availableCredits" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Submission" DROP COLUMN "rawFootages";

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pic" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "designation" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT,
    "brandId" TEXT,

    CONSTRAINT "Pic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RawFootage" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "submissionId" TEXT,

    CONSTRAINT "RawFootage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Photo" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "submissionId" TEXT,

    CONSTRAINT "Photo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicAccess" (
    "id" SERIAL NOT NULL,
    "campaignId" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "expiryDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublicAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Client_id_key" ON "Client"("id");

-- CreateIndex
CREATE UNIQUE INDEX "Client_userId_key" ON "Client"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Pic_id_key" ON "Pic"("id");

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_campaignId_key" ON "Campaign"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "Company_clientId_key" ON "Company"("clientId");

-- CreateIndex
CREATE INDEX "Company_clientId_idx" ON "Company"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "PackagesClient_packageId_key" ON "PackagesClient"("packageId");

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pic" ADD CONSTRAINT "Pic_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pic" ADD CONSTRAINT "Pic_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawFootage" ADD CONSTRAINT "RawFootage_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawFootage" ADD CONSTRAINT "RawFootage_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackagesClient" ADD CONSTRAINT "PackagesClient_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackagesClient" ADD CONSTRAINT "PackagesClient_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicAccess" ADD CONSTRAINT "PublicAccess_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

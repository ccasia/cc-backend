/*
  Warnings:

  - A unique constraint covering the columns `[packageId]` on the table `Brand` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "PackageType" AS ENUM ('Trail', 'Basic', 'Essential', 'Custom');

-- CreateEnum
CREATE TYPE "Currencies" AS ENUM ('MYR', 'SGD');

-- AlterTable
ALTER TABLE "Brand" ADD COLUMN     "packageId" TEXT;

-- CreateTable
CREATE TABLE "Packages" (
    "id" TEXT NOT NULL,
    "type" "PackageType" NOT NULL,
    "currency" "Currencies" NOT NULL,
    "value" INTEGER NOT NULL,
    "totalUGCCredits" INTEGER NOT NULL,
    "creditsUtilized" INTEGER NOT NULL,
    "availableCredits" INTEGER NOT NULL,
    "validityPeriod" INTEGER NOT NULL,

    CONSTRAINT "Packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackagesClient" (
    "id" TEXT NOT NULL,
    "type" "PackageType" NOT NULL,
    "currency" "Currencies" NOT NULL,
    "value" INTEGER NOT NULL,
    "totalUGCCredits" INTEGER NOT NULL,
    "creditsUtilized" INTEGER NOT NULL,
    "availableCredits" INTEGER NOT NULL,
    "validityPeriod" INTEGER NOT NULL,
    "invoiceDate" TIMESTAMP(3),
    "Remarks" JSONB,
    "invoiceLink" TEXT,

    CONSTRAINT "PackagesClient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Packages_id_key" ON "Packages"("id");

-- CreateIndex
CREATE UNIQUE INDEX "PackagesClient_id_key" ON "PackagesClient"("id");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_packageId_key" ON "Brand"("packageId");

-- AddForeignKey
ALTER TABLE "Brand" ADD CONSTRAINT "Brand_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "PackagesClient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

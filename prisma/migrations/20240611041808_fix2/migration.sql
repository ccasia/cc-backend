/*
  Warnings:

  - The primary key for the `AdminPermissionModule` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `module` on the `AdminPermissionModule` table. All the data in the column will be lost.
  - You are about to drop the column `permission` on the `AdminPermissionModule` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[id]` on the table `AdminPermissionModule` will be added. If there are existing duplicate values, this will fail.
  - The required column `id` was added to the `AdminPermissionModule` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.
  - Added the required column `permissionId` to the `AdminPermissionModule` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "Permissions" AS ENUM ('create', 'read', 'update', 'delete');

-- CreateEnum
CREATE TYPE "Modules" AS ENUM ('creator', 'campaign', 'brand', 'metric', 'invoice');

-- AlterTable
ALTER TABLE "AdminPermissionModule" DROP CONSTRAINT "AdminPermissionModule_pkey",
DROP COLUMN "module",
DROP COLUMN "permission",
ADD COLUMN     "id" TEXT NOT NULL,
ADD COLUMN     "permissionId" TEXT NOT NULL,
ADD CONSTRAINT "AdminPermissionModule_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "customTimelineCampaignId" TEXT,
ADD COLUMN     "defaultTimelineCampaignId" TEXT;

-- AlterTable
ALTER TABLE "MediaKit" ADD COLUMN     "interests" TEXT[];

-- DropEnum
DROP TYPE "Module";

-- DropEnum
DROP TYPE "Permission";

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "name" "Permissions" NOT NULL,
    "description" TEXT,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Module" (
    "id" TEXT NOT NULL,
    "name" "Modules" NOT NULL,
    "description" TEXT,

    CONSTRAINT "Module_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DefaultTimelineCampaign" (
    "id" TEXT NOT NULL,
    "openForPitch" INTEGER NOT NULL,
    "shortlistCreator" INTEGER NOT NULL,
    "firstDraft" INTEGER NOT NULL,
    "finalDraft" INTEGER NOT NULL,
    "feedBackFirstDraft" INTEGER NOT NULL,
    "feedBackFinalDraft" INTEGER NOT NULL,
    "filterPitch" INTEGER NOT NULL,
    "agreementSign" INTEGER NOT NULL,
    "qc" INTEGER NOT NULL,
    "posting" INTEGER NOT NULL,

    CONSTRAINT "DefaultTimelineCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomTimelineCampaign" (
    "id" TEXT NOT NULL,
    "openForPitch" INTEGER NOT NULL,
    "shortlistCreator" INTEGER NOT NULL,
    "firstDraft" INTEGER NOT NULL,
    "finalDraft" INTEGER NOT NULL,
    "feedBackFirstDraft" INTEGER NOT NULL,
    "feedBackFinalDraft" INTEGER NOT NULL,
    "filterPitch" INTEGER NOT NULL,
    "agreementSign" INTEGER NOT NULL,
    "qc" INTEGER NOT NULL,
    "posting" INTEGER NOT NULL,

    CONSTRAINT "CustomTimelineCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Permission_id_key" ON "Permission"("id");

-- CreateIndex
CREATE UNIQUE INDEX "Module_id_key" ON "Module"("id");

-- CreateIndex
CREATE UNIQUE INDEX "DefaultTimelineCampaign_id_key" ON "DefaultTimelineCampaign"("id");

-- CreateIndex
CREATE UNIQUE INDEX "CustomTimelineCampaign_id_key" ON "CustomTimelineCampaign"("id");

-- CreateIndex
CREATE UNIQUE INDEX "AdminPermissionModule_id_key" ON "AdminPermissionModule"("id");

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_defaultTimelineCampaignId_fkey" FOREIGN KEY ("defaultTimelineCampaignId") REFERENCES "DefaultTimelineCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_customTimelineCampaignId_fkey" FOREIGN KEY ("customTimelineCampaignId") REFERENCES "CustomTimelineCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminPermissionModule" ADD CONSTRAINT "AdminPermissionModule_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminPermissionModule" ADD CONSTRAINT "AdminPermissionModule_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

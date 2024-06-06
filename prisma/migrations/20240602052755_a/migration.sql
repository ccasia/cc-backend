/*
  Warnings:

  - You are about to drop the column `adminRole` on the `Admin` table. All the data in the column will be lost.
  - You are about to drop the `ManageCreatorPermission` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `designation` to the `Admin` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "Permission" AS ENUM ('EDITOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "Module" AS ENUM ('creator', 'campaign', 'brand', 'metric', 'invoice');

-- CreateEnum
CREATE TYPE "Resources" AS ENUM ('creator', 'brand', 'campaign');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'superadmin';

-- DropForeignKey
ALTER TABLE "ManageCreatorPermission" DROP CONSTRAINT "ManageCreatorPermission_adminId_fkey";

-- AlterTable
ALTER TABLE "Admin" DROP COLUMN "adminRole",
DROP COLUMN "designation",
ADD COLUMN     "designation" "Designation" NOT NULL;

-- DropTable
DROP TABLE "ManageCreatorPermission";

-- CreateTable
CREATE TABLE "AdminPermissionModule" (
    "adminId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "permission" "Permission" NOT NULL,
    "module" "Module" NOT NULL,

    CONSTRAINT "AdminPermissionModule_pkey" PRIMARY KEY ("adminId","moduleId")
);

-- AddForeignKey
ALTER TABLE "AdminPermissionModule" ADD CONSTRAINT "AdminPermissionModule_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

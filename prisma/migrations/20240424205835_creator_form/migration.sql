/*
  Warnings:

  - The values [inactive] on the enum `Status` will be removed. If these variants are still used in the database, this will fail.
  - The primary key for the `Admin` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `confirmationToken` on the `Admin` table. All the data in the column will be lost.
  - You are about to drop the column `userID` on the `Admin` table. All the data in the column will be lost.
  - The primary key for the `User` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the `Notification` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `emailInvite` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[id]` on the table `Admin` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[inviteToken]` on the table `Admin` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[userId]` on the table `Admin` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[id]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `userId` to the `Admin` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "Employment" AS ENUM ('student', 'employed', 'freelance', 'partTime', 'inBetweenJobs', 'selfEmployed', 'unemployed', 'others');

-- CreateEnum
CREATE TYPE "Languages" AS ENUM ('english', 'malay', 'mandarin', 'tamil', 'hindi', 'cantonese', 'all', 'others');

-- AlterEnum
BEGIN;
CREATE TYPE "Status_new" AS ENUM ('active', 'pending', 'banned', 'rejected');
ALTER TABLE "Admin" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Admin" ALTER COLUMN "status" TYPE "Status_new" USING ("status"::text::"Status_new");
ALTER TYPE "Status" RENAME TO "Status_old";
ALTER TYPE "Status_new" RENAME TO "Status";
DROP TYPE "Status_old";
ALTER TABLE "Admin" ALTER COLUMN "status" SET DEFAULT 'pending';
COMMIT;

-- DropForeignKey
ALTER TABLE "Admin" DROP CONSTRAINT "Admin_userID_fkey";

-- DropForeignKey
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_receiver_id_fkey";

-- DropIndex
DROP INDEX "Admin_confirmationToken_key";

-- DropIndex
DROP INDEX "Admin_userID_key";

-- AlterTable
ALTER TABLE "Admin" DROP CONSTRAINT "Admin_pkey",
DROP COLUMN "confirmationToken",
DROP COLUMN "userID",
ADD COLUMN     "inviteToken" TEXT,
ADD COLUMN     "userId" TEXT NOT NULL,
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ALTER COLUMN "name" DROP NOT NULL,
ALTER COLUMN "designation" DROP NOT NULL,
ALTER COLUMN "country" DROP NOT NULL,
ALTER COLUMN "phoneNumber" DROP NOT NULL,
ALTER COLUMN "mode" SET DEFAULT 'normal',
ALTER COLUMN "status" SET DEFAULT 'pending',
ADD CONSTRAINT "Admin_pkey" PRIMARY KEY ("id");
DROP SEQUENCE "Admin_id_seq";

-- AlterTable
ALTER TABLE "User" DROP CONSTRAINT "User_pkey",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ALTER COLUMN "password" DROP NOT NULL,
ADD CONSTRAINT "User_pkey" PRIMARY KEY ("id");
DROP SEQUENCE "User_id_seq";

-- DropTable
DROP TABLE "Notification";

-- DropTable
DROP TABLE "emailInvite";

-- CreateTable
CREATE TABLE "Creator" (
    "id" TEXT NOT NULL,
    "firstName" VARCHAR(100) NOT NULL,
    "lastName" VARCHAR(100) NOT NULL,
    "pronounce" VARCHAR(100),
    "phone" VARCHAR(100),
    "Nationality" VARCHAR(100),
    "location" VARCHAR(100),
    "birthDate" TIMESTAMP(3),
    "instagram" VARCHAR(100),
    "tiktok" VARCHAR(100),
    "employment" "Employment" DEFAULT 'others',
    "lanaugages" "Languages" DEFAULT 'malay',
    "industries" VARCHAR(200)[],
    "Interests" VARCHAR(200)[],
    "userId" TEXT NOT NULL,

    CONSTRAINT "Creator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Finance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Finance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Creator_id_key" ON "Creator"("id");

-- CreateIndex
CREATE UNIQUE INDEX "Creator_userId_key" ON "Creator"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Finance_id_key" ON "Finance"("id");

-- CreateIndex
CREATE UNIQUE INDEX "Finance_userId_key" ON "Finance"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Admin_id_key" ON "Admin"("id");

-- CreateIndex
CREATE UNIQUE INDEX "Admin_inviteToken_key" ON "Admin"("inviteToken");

-- CreateIndex
CREATE UNIQUE INDEX "Admin_userId_key" ON "Admin"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "User_id_key" ON "User"("id");

-- AddForeignKey
ALTER TABLE "Admin" ADD CONSTRAINT "Admin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Creator" ADD CONSTRAINT "Creator_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finance" ADD CONSTRAINT "Finance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

/*
  Warnings:

  - You are about to drop the column `userId` on the `Campaign` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "Campaign" DROP CONSTRAINT "Campaign_userId_fkey";

-- AlterTable
ALTER TABLE "Campaign" DROP COLUMN "userId";

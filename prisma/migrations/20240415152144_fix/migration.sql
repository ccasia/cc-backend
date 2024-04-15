/*
  Warnings:

  - You are about to drop the column `confirmationToken` on the `Admin` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "Admin_confirmationToken_key";

-- AlterTable
ALTER TABLE "Admin" DROP COLUMN "confirmationToken";

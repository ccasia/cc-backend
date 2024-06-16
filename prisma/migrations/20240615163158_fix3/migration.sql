/*
  Warnings:

  - You are about to drop the column `intersets` on the `Brand` table. All the data in the column will be lost.
  - You are about to drop the column `registration_number` on the `Brand` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "Brand_registration_number_key";

-- AlterTable
ALTER TABLE "Brand" DROP COLUMN "intersets",
DROP COLUMN "registration_number";

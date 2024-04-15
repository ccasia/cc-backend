/*
  Warnings:

  - You are about to drop the column `firstname` on the `Creator` table. All the data in the column will be lost.
  - You are about to drop the column `lastname` on the `Creator` table. All the data in the column will be lost.
  - Added the required column `firstName` to the `Creator` table without a default value. This is not possible if the table is not empty.
  - Added the required column `lastName` to the `Creator` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Creator" DROP COLUMN "firstname",
DROP COLUMN "lastname",
ADD COLUMN     "firstName" VARCHAR(100) NOT NULL,
ADD COLUMN     "lastName" VARCHAR(100) NOT NULL;

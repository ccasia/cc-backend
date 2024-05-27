/*
  Warnings:

  - You are about to drop the column `descritpion` on the `Event` table. All the data in the column will be lost.
  - Added the required column `description` to the `Event` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Event" DROP COLUMN "descritpion",
ADD COLUMN     "description" TEXT NOT NULL;

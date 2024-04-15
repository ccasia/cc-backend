/*
  Warnings:

  - Added the required column `firstname` to the `Creator` table without a default value. This is not possible if the table is not empty.
  - Added the required column `lastname` to the `Creator` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Creator" ADD COLUMN     "firstname" VARCHAR(100) NOT NULL,
ADD COLUMN     "lastname" VARCHAR(100) NOT NULL;

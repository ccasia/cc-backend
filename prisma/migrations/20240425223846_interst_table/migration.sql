/*
  Warnings:

  - The values [employed,partTime,inBetweenJobs,selfEmployed] on the enum `Employment` will be removed. If these variants are still used in the database, this will fail.
  - The values [english,malay,mandarin,tamil,hindi,cantonese,others] on the enum `Languages` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `Interests` on the `Creator` table. All the data in the column will be lost.
  - You are about to drop the column `industries` on the `Creator` table. All the data in the column will be lost.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "Employment_new" AS ENUM ('fulltime', 'freelance', 'parttime', 'student', 'in_between', 'unemployed', 'others');
ALTER TABLE "Creator" ALTER COLUMN "employment" DROP DEFAULT;
ALTER TABLE "Creator" ALTER COLUMN "employment" TYPE "Employment_new" USING ("employment"::text::"Employment_new");
ALTER TYPE "Employment" RENAME TO "Employment_old";
ALTER TYPE "Employment_new" RENAME TO "Employment";
DROP TYPE "Employment_old";
ALTER TABLE "Creator" ALTER COLUMN "employment" SET DEFAULT 'others';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "Languages_new" AS ENUM ('English', 'Malay', 'Mandarin', 'Hindi', 'Others', 'all');
ALTER TABLE "Creator" ALTER COLUMN "lanaugages" DROP DEFAULT;
ALTER TABLE "Creator" ALTER COLUMN "lanaugages" TYPE "Languages_new" USING ("lanaugages"::text::"Languages_new");
ALTER TYPE "Languages" RENAME TO "Languages_old";
ALTER TYPE "Languages_new" RENAME TO "Languages";
DROP TYPE "Languages_old";
ALTER TABLE "Creator" ALTER COLUMN "lanaugages" SET DEFAULT 'Malay';
COMMIT;

-- AlterTable
ALTER TABLE "Creator" DROP COLUMN "Interests",
DROP COLUMN "industries",
ALTER COLUMN "lanaugages" SET DEFAULT 'Malay';

-- CreateTable
CREATE TABLE "Industry" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "rank" INTEGER,
    "creatorId" TEXT NOT NULL,

    CONSTRAINT "Industry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Interest" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "rank" INTEGER,
    "creatorId" TEXT NOT NULL,

    CONSTRAINT "Interest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Industry_id_key" ON "Industry"("id");

-- CreateIndex
CREATE UNIQUE INDEX "Interest_id_key" ON "Interest"("id");

-- AddForeignKey
ALTER TABLE "Industry" ADD CONSTRAINT "Industry_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interest" ADD CONSTRAINT "Interest_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

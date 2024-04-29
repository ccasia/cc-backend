/*
  Warnings:

  - You are about to drop the column `lanaugages` on the `Creator` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Creator" DROP COLUMN "lanaugages";

-- DropEnum
DROP TYPE "Languages";

-- CreateTable
CREATE TABLE "Language" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "creatorId" TEXT NOT NULL,

    CONSTRAINT "Language_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Language_id_key" ON "Language"("id");

-- AddForeignKey
ALTER TABLE "Language" ADD CONSTRAINT "Language_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

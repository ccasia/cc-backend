/*
  Warnings:

  - You are about to drop the column `creatorId` on the `Industry` table. All the data in the column will be lost.
  - You are about to drop the column `creatorId` on the `Interest` table. All the data in the column will be lost.
  - You are about to drop the `Language` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `userId` to the `Industry` table without a default value. This is not possible if the table is not empty.
  - Added the required column `userId` to the `Interest` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Industry" DROP CONSTRAINT "Industry_creatorId_fkey";

-- DropForeignKey
ALTER TABLE "Interest" DROP CONSTRAINT "Interest_creatorId_fkey";

-- DropForeignKey
ALTER TABLE "Language" DROP CONSTRAINT "Language_creatorId_fkey";

-- AlterTable
ALTER TABLE "Creator" ADD COLUMN     "languages" JSONB;

-- AlterTable
ALTER TABLE "Industry" DROP COLUMN "creatorId",
ADD COLUMN     "userId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Interest" DROP COLUMN "creatorId",
ADD COLUMN     "userId" TEXT NOT NULL;

-- DropTable
DROP TABLE "Language";

-- AddForeignKey
ALTER TABLE "Industry" ADD CONSTRAINT "Industry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Creator"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interest" ADD CONSTRAINT "Interest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Creator"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

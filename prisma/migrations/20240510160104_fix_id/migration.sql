-- DropForeignKey
ALTER TABLE "Industry" DROP CONSTRAINT "Industry_creatorId_fkey";

-- DropForeignKey
ALTER TABLE "Interest" DROP CONSTRAINT "Interest_creatorId_fkey";

-- DropForeignKey
ALTER TABLE "Language" DROP CONSTRAINT "Language_creatorId_fkey";

-- AlterTable
ALTER TABLE "Admin" ADD COLUMN     "adminRole" TEXT;

-- AddForeignKey
ALTER TABLE "Language" ADD CONSTRAINT "Language_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Industry" ADD CONSTRAINT "Industry_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interest" ADD CONSTRAINT "Interest_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

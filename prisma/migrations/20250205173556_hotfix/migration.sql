/*
  Warnings:

  - Made the column `packageId` on table `PackagesClient` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "PackagesClient" DROP CONSTRAINT "PackagesClient_packageId_fkey";

-- DropIndex
DROP INDEX "PackagesClient_packageId_key";

-- AlterTable
ALTER TABLE "PackagesClient" ALTER COLUMN "packageId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "PackagesClient" ADD CONSTRAINT "PackagesClient_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

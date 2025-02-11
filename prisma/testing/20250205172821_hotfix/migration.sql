-- DropForeignKey
ALTER TABLE "PackagesClient" DROP CONSTRAINT "PackagesClient_packageId_fkey";

-- AlterTable
ALTER TABLE "PackagesClient" ALTER COLUMN "packageId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "PackagesClient" ADD CONSTRAINT "PackagesClient_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

/*
  Warnings:

  - You are about to drop the column `isNdaRequired` on the `AgreementTemplate` table. All the data in the column will be lost.
  - You are about to drop the column `isArchived` on the `Package` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "AgreementTemplate" DROP COLUMN "isNdaRequired";

-- AlterTable
ALTER TABLE "Package" DROP COLUMN "isArchived";

-- AlterTable
ALTER TABLE "UploadSession" ADD COLUMN     "fileName" TEXT;

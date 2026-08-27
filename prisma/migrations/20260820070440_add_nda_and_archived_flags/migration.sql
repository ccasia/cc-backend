-- AlterTable
ALTER TABLE "AgreementTemplate" ADD COLUMN     "isNdaRequired" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Package" ADD COLUMN     "isArchived" BOOLEAN NOT NULL DEFAULT false;

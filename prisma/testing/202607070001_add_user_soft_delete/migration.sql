-- AlterEnum
ALTER TYPE "Status" ADD VALUE 'deleted';

-- AlterTable
ALTER TABLE "User" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SubmissionComment" ADD COLUMN     "annotation" JSONB,
ADD COLUMN     "frameTimeMs" INTEGER;

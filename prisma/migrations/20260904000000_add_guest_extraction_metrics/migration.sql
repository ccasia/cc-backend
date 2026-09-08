-- AlterTable
ALTER TABLE "GuestProfileExtraction" ADD COLUMN     "costUsd" DECIMAL(10,6),
ADD COLUMN     "duplicateStartAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reusedFromExtractionId" TEXT;

-- CreateIndex
CREATE INDEX "GuestProfileExtraction_completedAt_idx" ON "GuestProfileExtraction"("completedAt");


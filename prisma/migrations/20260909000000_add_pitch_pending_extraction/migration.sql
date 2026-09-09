-- AlterTable
ALTER TABLE "Pitch" ADD COLUMN "pendingExtractionId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Pitch_pendingExtractionId_key" ON "Pitch"("pendingExtractionId");

-- AddForeignKey
ALTER TABLE "Pitch" ADD CONSTRAINT "Pitch_pendingExtractionId_fkey" FOREIGN KEY ("pendingExtractionId") REFERENCES "GuestProfileExtraction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

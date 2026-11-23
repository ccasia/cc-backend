-- AlterTable
ALTER TABLE "insight_ocr_result" ADD COLUMN     "campaignId" TEXT,
ADD COLUMN     "postUrl" TEXT,
ADD COLUMN     "submissionId" TEXT;

-- CreateIndex
CREATE INDEX "insight_ocr_result_campaignId_idx" ON "insight_ocr_result"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "insight_ocr_result_submissionId_postUrl_key" ON "insight_ocr_result"("submissionId", "postUrl");

-- AddForeignKey
ALTER TABLE "insight_ocr_result" ADD CONSTRAINT "insight_ocr_result_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insight_ocr_result" ADD CONSTRAINT "insight_ocr_result_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;


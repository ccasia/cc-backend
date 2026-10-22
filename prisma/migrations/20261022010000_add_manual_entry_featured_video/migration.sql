-- AlterTable
ALTER TABLE "CampaignFeaturedVideo" ADD COLUMN     "manualEntryId" TEXT,
ALTER COLUMN "submissionId" DROP NOT NULL,
ALTER COLUMN "postUrl" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "CampaignFeaturedVideo_campaignId_manualEntryId_key" ON "CampaignFeaturedVideo"("campaignId", "manualEntryId");

-- AddForeignKey
ALTER TABLE "CampaignFeaturedVideo" ADD CONSTRAINT "CampaignFeaturedVideo_manualEntryId_fkey" FOREIGN KEY ("manualEntryId") REFERENCES "ManualCreatorEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Exactly one source per row, and submission rows always name their post.
ALTER TABLE "CampaignFeaturedVideo" ADD CONSTRAINT "CampaignFeaturedVideo_one_source_check"
  CHECK (("submissionId" IS NULL) <> ("manualEntryId" IS NULL));
ALTER TABLE "CampaignFeaturedVideo" ADD CONSTRAINT "CampaignFeaturedVideo_submission_post_check"
  CHECK ("submissionId" IS NULL OR "postUrl" IS NOT NULL);

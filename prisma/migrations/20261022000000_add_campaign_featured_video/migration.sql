-- CreateTable
CREATE TABLE "CampaignFeaturedVideo" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "postUrl" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignFeaturedVideo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CampaignFeaturedVideo_campaignId_submissionId_postUrl_key" ON "CampaignFeaturedVideo"("campaignId", "submissionId", "postUrl");

-- AddForeignKey
ALTER TABLE "CampaignFeaturedVideo" ADD CONSTRAINT "CampaignFeaturedVideo_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignFeaturedVideo" ADD CONSTRAINT "CampaignFeaturedVideo_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignFeaturedVideo" ADD CONSTRAINT "CampaignFeaturedVideo_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


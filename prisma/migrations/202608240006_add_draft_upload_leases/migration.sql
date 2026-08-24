-- CreateTable
CREATE TABLE "CampaignCreationDraftUploadLease" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "objectUrl" TEXT,
    "cleanupPending" BOOLEAN NOT NULL DEFAULT false,
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignCreationDraftUploadLease_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CampaignCreationDraftUploadLease_draftId_expiresAt_idx" ON "CampaignCreationDraftUploadLease"("draftId", "expiresAt");
CREATE INDEX "CampaignCreationDraftUploadLease_ownerId_draftId_idx" ON "CampaignCreationDraftUploadLease"("ownerId", "draftId");

-- AddForeignKey
ALTER TABLE "CampaignCreationDraftUploadLease" ADD CONSTRAINT "CampaignCreationDraftUploadLease_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "CampaignCreationDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignCreationDraftUploadLease" ADD CONSTRAINT "CampaignCreationDraftUploadLease_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

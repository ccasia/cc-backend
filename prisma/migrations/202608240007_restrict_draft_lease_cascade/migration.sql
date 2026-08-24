-- AlterTable
ALTER TABLE "CampaignCreationDraftUploadLease"
DROP CONSTRAINT "CampaignCreationDraftUploadLease_draftId_fkey",
ADD CONSTRAINT "CampaignCreationDraftUploadLease_draftId_fkey"
  FOREIGN KEY ("draftId") REFERENCES "CampaignCreationDraft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

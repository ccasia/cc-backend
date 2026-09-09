-- CreateTable
CREATE TABLE "CampaignCreationDraft" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "activeStep" INTEGER NOT NULL,
    "showAdditionalDetails" BOOLEAN NOT NULL,
    "revision" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignCreationDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CampaignCreationDraft_ownerId_updatedAt_idx" ON "CampaignCreationDraft"("ownerId", "updatedAt");

-- AddForeignKey
ALTER TABLE "CampaignCreationDraft" ADD CONSTRAINT "CampaignCreationDraft_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

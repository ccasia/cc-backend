-- AlterTable
ALTER TABLE "ShortListedCreator" ADD COLUMN     "isCreatorPaid" BOOLEAN DEFAULT false,
ALTER COLUMN "isAgreementReady" DROP NOT NULL,
ALTER COLUMN "isCampaignDone" DROP NOT NULL;

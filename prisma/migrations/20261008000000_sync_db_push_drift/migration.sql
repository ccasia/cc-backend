-- CreateEnum
CREATE TYPE "InvoiceType" AS ENUM ('STANDARD', 'REIMBURSEMENT');

-- CreateEnum
CREATE TYPE "ReimbursementStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReleaseNoteItemType" AS ENUM ('NEW', 'IMPROVED', 'FIXED');

-- CreateEnum
CREATE TYPE "ReleaseNoteStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'SCHEDULED');

-- CreateEnum
CREATE TYPE "RewardType" AS ENUM ('repeatable', 'one_time');

-- AlterEnum
ALTER TYPE "Entity" ADD VALUE 'Reimbursement';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "XpSourceType" ADD VALUE 'PITCH_SUBMITTED';
ALTER TYPE "XpSourceType" ADD VALUE 'PITCH_APPROVED';
ALTER TYPE "XpSourceType" ADD VALUE 'SHORTLISTED';
ALTER TYPE "XpSourceType" ADD VALUE 'SUBMISSION_SUBMITTED';
ALTER TYPE "XpSourceType" ADD VALUE 'SUBMISSION_APPROVED';
ALTER TYPE "XpSourceType" ADD VALUE 'POSTING_SUBMITTED';
ALTER TYPE "XpSourceType" ADD VALUE 'POSTING_APPROVED';
ALTER TYPE "XpSourceType" ADD VALUE 'CLIENT_RATING';
ALTER TYPE "XpSourceType" ADD VALUE 'MEDIA_KIT_CONNECTED';
ALTER TYPE "XpSourceType" ADD VALUE 'LEADERBOARD_TOP_10';
ALTER TYPE "XpSourceType" ADD VALUE 'LEADERBOARD_TOP_3';
ALTER TYPE "XpSourceType" ADD VALUE 'WEEKLY_TASK';
ALTER TYPE "XpSourceType" ADD VALUE 'ACHIEVEMENT';

-- DropForeignKey
ALTER TABLE "UploadSession" DROP CONSTRAINT "UploadSession_videoId_fkey";

-- DropIndex
DROP INDEX "CreatorAgreement_userId_campaignId_key";

-- DropIndex
DROP INDEX "UploadSession_videoId_key";

-- DropIndex
DROP INDEX "XpTransaction_sourceType_sourceId_key";

-- AlterTable
ALTER TABLE "AgreementTemplate" ADD COLUMN     "isNdaRequired" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Bugs" ADD COLUMN     "category" TEXT,
ADD COLUMN     "context" JSONB;

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "isNdaRequired" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "isArchived" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "CreatorAgreement" ADD COLUMN     "creditPerVideo" INTEGER,
ADD COLUMN     "creditTierId" TEXT,
ADD COLUMN     "creditsAssigned" INTEGER,
ADD COLUMN     "followerCount" INTEGER,
ADD COLUMN     "isReceiptRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isSeeding" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "receiptsSubmittedAt" TIMESTAMP(3),
ADD COLUMN     "round" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "selectedPlatform" "SocialPlatform",
ADD COLUMN     "videoCount" INTEGER;

-- AlterTable
ALTER TABLE "GuestProfileExtraction" ADD COLUMN     "profileActorDatasetId" VARCHAR(60),
ADD COLUMN     "profileActorRunId" VARCHAR(60),
ADD COLUMN     "profileCostUsd" DECIMAL(10,6),
ADD COLUMN     "resultBiography" TEXT,
ADD COLUMN     "resultProfilePictureUrl" TEXT,
ADD COLUMN     "topUpRunId" VARCHAR(60);

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "invoiceType" "InvoiceType" NOT NULL DEFAULT 'STANDARD',
ADD COLUMN     "parentInvoiceId" TEXT,
ADD COLUMN     "reimbursements" JSONB,
ADD COLUMN     "round" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Package" ADD COLUMN     "isArchived" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ResetPasswordToken" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "expiresAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Submission" ADD COLUMN     "viewedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "UploadSession" DROP COLUMN "videoId";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastSeenReleaseNoteAt" TIMESTAMP(3),
ALTER COLUMN "appleAudience" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "UserXpBalance" ADD COLUMN     "currentRankId" TEXT,
ADD COLUMN     "mediaKitBonusAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Video" ADD COLUMN     "uploadSessionId" TEXT;

-- AlterTable
ALTER TABLE "XpTransaction" ADD COLUMN     "actionId" TEXT,
ADD COLUMN     "periodId" TEXT,
ALTER COLUMN "sourceType" DROP NOT NULL;

-- CreateTable
CREATE TABLE "Achievement" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "rarity" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "xp" INTEGER NOT NULL,
    "target" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Achievement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlockedBrand" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlockedBrand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignFlag" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorAchievement" (
    "userId" TEXT NOT NULL,
    "achievementId" TEXT NOT NULL,
    "unlockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorAchievement_pkey" PRIMARY KEY ("userId","achievementId")
);

-- CreateTable
CREATE TABLE "CreatorAchievementEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "achievementId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "increment" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreatorAchievementEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorDiscoveryProfile" (
    "biography" TEXT,
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "profileUrl" TEXT,
    "handle" TEXT,
    "followers" INTEGER,
    "engagementRate" DOUBLE PRECISION,
    "followersSource" "GuestMetricSource",
    "engagementRateSource" "GuestMetricSource",
    "followersSavedAt" TIMESTAMP(3),
    "engagementRateSavedAt" TIMESTAMP(3),
    "savedAt" TIMESTAMP(3) NOT NULL,
    "scrapedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "linkedAt" TIMESTAMP(3),
    "scrapeDetails" JSONB,
    "captions" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "CreatorDiscoveryProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaderboardSnapshot" (
    "periodId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "xp" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaderboardSnapshot_pkey" PRIMARY KEY ("periodId","userId")
);

-- CreateTable
CREATE TABLE "ProductSeeding" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creatorAgreementId" TEXT,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "ProductSeeding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rank" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "minPoints" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rank_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReimbursementReceipt" (
    "id" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "order" INTEGER NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'MYR',
    "description" TEXT NOT NULL,
    "status" "ReimbursementStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "rejectionReason" TEXT,
    "financeNote" TEXT,
    "invoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReimbursementReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReleaseNote" (
    "id" TEXT NOT NULL,
    "releaseDate" TIMESTAMP(3) NOT NULL,
    "status" "ReleaseNoteStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReleaseNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReleaseNoteItem" (
    "id" TEXT NOT NULL,
    "releaseNoteId" TEXT NOT NULL,
    "type" "ReleaseNoteItemType" NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ReleaseNoteItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "xp_action" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "points" INTEGER,
    "rewardType" "RewardType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "xp_action_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Achievement_code_key" ON "Achievement"("code" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "BlockedBrand_id_key" ON "BlockedBrand"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "BlockedBrand_userId_companyId_key" ON "BlockedBrand"("userId" ASC, "companyId" ASC);

-- CreateIndex
CREATE INDEX "BlockedBrand_userId_idx" ON "BlockedBrand"("userId" ASC);

-- CreateIndex
CREATE INDEX "CampaignFlag_campaignId_idx" ON "CampaignFlag"("campaignId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "CampaignFlag_id_key" ON "CampaignFlag"("id" ASC);

-- CreateIndex
CREATE INDEX "CampaignFlag_userId_idx" ON "CampaignFlag"("userId" ASC);

-- CreateIndex
CREATE INDEX "CreatorAchievement_achievementId_idx" ON "CreatorAchievement"("achievementId" ASC);

-- CreateIndex
CREATE INDEX "CreatorAchievementEvent_userId_achievementId_idx" ON "CreatorAchievementEvent"("userId" ASC, "achievementId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "CreatorAchievementEvent_userId_achievementId_sourceId_key" ON "CreatorAchievementEvent"("userId" ASC, "achievementId" ASC, "sourceId" ASC);

-- CreateIndex
CREATE INDEX "CreatorDiscoveryProfile_platform_idx" ON "CreatorDiscoveryProfile"("platform" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "CreatorDiscoveryProfile_userId_platform_key" ON "CreatorDiscoveryProfile"("userId" ASC, "platform" ASC);

-- CreateIndex
CREATE INDEX "LeaderboardSnapshot_userId_idx" ON "LeaderboardSnapshot"("userId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ProductSeeding_id_key" ON "ProductSeeding"("id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Rank_name_key" ON "Rank"("name" ASC);

-- CreateIndex
CREATE INDEX "ReimbursementReceipt_agreementId_idx" ON "ReimbursementReceipt"("agreementId" ASC);

-- CreateIndex
CREATE INDEX "ReimbursementReceipt_campaignId_userId_round_idx" ON "ReimbursementReceipt"("campaignId" ASC, "userId" ASC, "round" ASC);

-- CreateIndex
CREATE INDEX "ReleaseNote_status_publishedAt_idx" ON "ReleaseNote"("status" ASC, "publishedAt" ASC);

-- CreateIndex
CREATE INDEX "ReleaseNoteItem_releaseNoteId_idx" ON "ReleaseNoteItem"("releaseNoteId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "xp_action_code_key" ON "xp_action"("code" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "CreatorAgreement_userId_campaignId_round_key" ON "CreatorAgreement"("userId" ASC, "campaignId" ASC, "round" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Video_uploadSessionId_key" ON "Video"("uploadSessionId" ASC);

-- CreateIndex
CREATE INDEX "XpTransaction_actionId_idx" ON "XpTransaction"("actionId" ASC);

-- CreateIndex
CREATE INDEX "XpTransaction_periodId_idx" ON "XpTransaction"("periodId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "XpTransaction_userId_actionId_sourceId_key" ON "XpTransaction"("userId" ASC, "actionId" ASC, "sourceId" ASC);

-- AddForeignKey
ALTER TABLE "BlockedBrand" ADD CONSTRAINT "BlockedBrand_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlockedBrand" ADD CONSTRAINT "BlockedBrand_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignFlag" ADD CONSTRAINT "CampaignFlag_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignFlag" ADD CONSTRAINT "CampaignFlag_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorAchievement" ADD CONSTRAINT "CreatorAchievement_achievementId_fkey" FOREIGN KEY ("achievementId") REFERENCES "Achievement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorAchievement" ADD CONSTRAINT "CreatorAchievement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorAchievementEvent" ADD CONSTRAINT "CreatorAchievementEvent_userId_achievementId_fkey" FOREIGN KEY ("userId", "achievementId") REFERENCES "CreatorAchievement"("userId", "achievementId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorAgreement" ADD CONSTRAINT "CreatorAgreement_creditTierId_fkey" FOREIGN KEY ("creditTierId") REFERENCES "CreditTier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorDiscoveryProfile" ADD CONSTRAINT "CreatorDiscoveryProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Creator"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaderboardSnapshot" ADD CONSTRAINT "LeaderboardSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSeeding" ADD CONSTRAINT "ProductSeeding_creatorAgreementId_fkey" FOREIGN KEY ("creatorAgreementId") REFERENCES "CreatorAgreement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReimbursementReceipt" ADD CONSTRAINT "ReimbursementReceipt_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "CreatorAgreement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseNote" ADD CONSTRAINT "ReleaseNote_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseNoteItem" ADD CONSTRAINT "ReleaseNoteItem_releaseNoteId_fkey" FOREIGN KEY ("releaseNoteId") REFERENCES "ReleaseNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserXpBalance" ADD CONSTRAINT "UserXpBalance_currentRankId_fkey" FOREIGN KEY ("currentRankId") REFERENCES "Rank"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_uploadSessionId_fkey" FOREIGN KEY ("uploadSessionId") REFERENCES "UploadSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "XpTransaction" ADD CONSTRAINT "XpTransaction_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "xp_action"("id") ON DELETE SET NULL ON UPDATE CASCADE;


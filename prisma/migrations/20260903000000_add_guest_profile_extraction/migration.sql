-- CreateEnum
CREATE TYPE "GuestProfileExtractionStatus" AS ENUM ('QUEUED', 'RUNNING', 'POLLING', 'READY', 'INSUFFICIENT_DATA', 'FAILED', 'CANCELLED', 'STALE', 'REQUIRES_RECONCILIATION');

-- CreateEnum
CREATE TYPE "GuestMetricSource" AS ENUM ('automatic', 'manual_override', 'unavailable');

-- CreateEnum
CREATE TYPE "GuestIdentityConflictStatus" AS ENUM ('UNRESOLVED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "GuestCreateRequestStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "Creator" ADD COLUMN     "guestProfileKey" VARCHAR(120);

-- CreateTable
CREATE TABLE "GuestProfileExtraction" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "canonicalProfileKey" VARCHAR(120) NOT NULL,
    "canonicalProfileUrl" VARCHAR(255) NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "actorId" VARCHAR(120) NOT NULL,
    "actorBuild" VARCHAR(40) NOT NULL,
    "actorRunId" VARCHAR(60),
    "actorDatasetId" VARCHAR(60),
    "status" "GuestProfileExtractionStatus" NOT NULL DEFAULT 'QUEUED',
    "resultName" VARCHAR(255),
    "resultFollowerCount" INTEGER,
    "resultEngagementRate" VARCHAR(24),
    "sampleSize" INTEGER,
    "formulaVersion" VARCHAR(60),
    "selectedPosts" JSONB,
    "unverifiedFlags" TEXT[],
    "failureCode" VARCHAR(60),
    "failureMessage" TEXT,
    "idempotencyKey" VARCHAR(120) NOT NULL,
    "requestFingerprint" VARCHAR(64) NOT NULL,
    "receiptNonce" VARCHAR(64),
    "receiptDigest" VARCHAR(64),
    "receiptExpiresAt" TIMESTAMP(3),
    "receiptConsumedAt" TIMESTAMP(3),
    "reconcileAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastReconciledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "GuestProfileExtraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestCreatorMetricAudit" (
    "id" TEXT NOT NULL,
    "pitchId" TEXT NOT NULL,
    "extractionId" TEXT,
    "guestUserId" TEXT,
    "canonicalProfileKey" VARCHAR(120),
    "platform" "SocialPlatform",
    "originalName" VARCHAR(255),
    "originalFollowerCount" INTEGER,
    "originalEngagementRate" VARCHAR(24),
    "finalName" VARCHAR(255),
    "finalFollowerCount" INTEGER,
    "finalEngagementRate" VARCHAR(24),
    "source" "GuestMetricSource" NOT NULL,
    "overrideReason" TEXT,
    "actorId" VARCHAR(120),
    "actorBuild" VARCHAR(40),
    "actorRunId" VARCHAR(60),
    "formulaVersion" VARCHAR(60),
    "performedByUserId" TEXT NOT NULL,
    "reviewerUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestCreatorMetricAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestCreatorCreateRequest" (
    "id" TEXT NOT NULL,
    "performedByUserId" VARCHAR(60) NOT NULL,
    "operation" VARCHAR(60) NOT NULL,
    "idempotencyKey" VARCHAR(120) NOT NULL,
    "campaignId" TEXT NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "status" "GuestCreateRequestStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "responseStatus" INTEGER,
    "responseBody" JSONB,
    "resultPitchIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "GuestCreatorCreateRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestProfileIdentityConflict" (
    "id" TEXT NOT NULL,
    "canonicalProfileKey" VARCHAR(120) NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "creatorIds" TEXT[],
    "userIds" TEXT[],
    "profileLinks" TEXT[],
    "status" "GuestIdentityConflictStatus" NOT NULL DEFAULT 'UNRESOLVED',
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "resolutionNote" TEXT,

    CONSTRAINT "GuestProfileIdentityConflict_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GuestProfileExtraction_receiptNonce_key" ON "GuestProfileExtraction"("receiptNonce");

-- CreateIndex
CREATE INDEX "GuestProfileExtraction_canonicalProfileKey_platform_actorBu_idx" ON "GuestProfileExtraction"("canonicalProfileKey", "platform", "actorBuild", "status");

-- CreateIndex
CREATE INDEX "GuestProfileExtraction_requestedByUserId_status_idx" ON "GuestProfileExtraction"("requestedByUserId", "status");

-- CreateIndex
CREATE INDEX "GuestProfileExtraction_campaignId_status_idx" ON "GuestProfileExtraction"("campaignId", "status");

-- CreateIndex
CREATE INDEX "GuestProfileExtraction_status_updatedAt_idx" ON "GuestProfileExtraction"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "GuestProfileExtraction_expiresAt_idx" ON "GuestProfileExtraction"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "GuestProfileExtraction_requestedByUserId_idempotencyKey_key" ON "GuestProfileExtraction"("requestedByUserId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "GuestCreatorMetricAudit_pitchId_idx" ON "GuestCreatorMetricAudit"("pitchId");

-- CreateIndex
CREATE INDEX "GuestCreatorMetricAudit_extractionId_idx" ON "GuestCreatorMetricAudit"("extractionId");

-- CreateIndex
CREATE INDEX "GuestCreatorMetricAudit_canonicalProfileKey_idx" ON "GuestCreatorMetricAudit"("canonicalProfileKey");

-- CreateIndex
CREATE INDEX "GuestCreatorMetricAudit_performedByUserId_createdAt_idx" ON "GuestCreatorMetricAudit"("performedByUserId", "createdAt");

-- CreateIndex
CREATE INDEX "GuestCreatorCreateRequest_campaignId_idx" ON "GuestCreatorCreateRequest"("campaignId");

-- CreateIndex
CREATE INDEX "GuestCreatorCreateRequest_expiresAt_idx" ON "GuestCreatorCreateRequest"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "GuestCreatorCreateRequest_performedByUserId_operation_idemp_key" ON "GuestCreatorCreateRequest"("performedByUserId", "operation", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "GuestProfileIdentityConflict_canonicalProfileKey_key" ON "GuestProfileIdentityConflict"("canonicalProfileKey");

-- CreateIndex
CREATE INDEX "GuestProfileIdentityConflict_status_idx" ON "GuestProfileIdentityConflict"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Creator_guestProfileKey_key" ON "Creator"("guestProfileKey");

-- AddForeignKey
ALTER TABLE "GuestProfileExtraction" ADD CONSTRAINT "GuestProfileExtraction_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestCreatorMetricAudit" ADD CONSTRAINT "GuestCreatorMetricAudit_pitchId_fkey" FOREIGN KEY ("pitchId") REFERENCES "Pitch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestCreatorMetricAudit" ADD CONSTRAINT "GuestCreatorMetricAudit_extractionId_fkey" FOREIGN KEY ("extractionId") REFERENCES "GuestProfileExtraction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestCreatorCreateRequest" ADD CONSTRAINT "GuestCreatorCreateRequest_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;


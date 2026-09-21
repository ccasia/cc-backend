-- CreateEnum
CREATE TYPE "TreasureHuntStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TreasureHuntClaimSource" AS ENUM ('IN_APP_CAMERA', 'EXTERNAL_LINK');

-- CreateEnum
CREATE TYPE "BitlyPublicationStatus" AS ENUM ('NOT_STARTED', 'BITLINK_CREATED', 'QR_CREATED', 'READY', 'RATE_LIMITED', 'FAILED');

-- CreateEnum
CREATE TYPE "XpSourceType" AS ENUM ('HUNT_LOCATION_CLAIM');

-- CreateTable
CREATE TABLE "TreasureHunt" (
    "id" TEXT NOT NULL,
    "eventKey" VARCHAR(50) NOT NULL DEFAULT 'FIND_CIPTA',
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT NOT NULL,
    "heroArtworkUrl" VARCHAR(2048),
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "rewardXp" INTEGER NOT NULL DEFAULT 50,
    "status" "TreasureHuntStatus" NOT NULL DEFAULT 'DRAFT',
    "featuredSlot" INTEGER,
    "publishedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TreasureHunt_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TreasureHunt_single_event" CHECK ("eventKey" = 'FIND_CIPTA'),
    CONSTRAINT "TreasureHunt_valid_dates" CHECK ("endsAt" > "startsAt"),
    CONSTRAINT "TreasureHunt_positive_reward" CHECK ("rewardXp" > 0),
    CONSTRAINT "TreasureHunt_featured_slot" CHECK ("featuredSlot" IS NULL OR "featuredSlot" = 1)
);

-- CreateTable
CREATE TABLE "TreasureHuntLocation" (
    "id" TEXT NOT NULL,
    "huntId" TEXT NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "hint" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "artworkUrl" VARCHAR(2048) NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "publicTokenHash" VARCHAR(64),
    "publicTokenCiphertext" TEXT,
    "tokenIssuedAt" TIMESTAMP(3),
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TreasureHuntLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TreasureHuntBitlyPublication" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "status" "BitlyPublicationStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "bitlinkId" VARCHAR(255),
    "bitlinkUrl" VARCHAR(2048),
    "qrCodeId" VARCHAR(255),
    "qrImageUrl" VARCHAR(2048),
    "rawScanCount" INTEGER NOT NULL DEFAULT 0,
    "analyticsSource" VARCHAR(100),
    "lastAnalyticsSyncedAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "nextRetryAt" TIMESTAMP(3),
    "lastErrorCode" VARCHAR(100),
    "lastErrorMessage" TEXT,
    "leaseId" VARCHAR(64),
    "leaseExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TreasureHuntBitlyPublication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TreasureHuntClaim" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "source" "TreasureHuntClaimSource" NOT NULL,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TreasureHuntClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TreasureHuntCapture" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "objectPath" VARCHAR(2048) NOT NULL,
    "contentType" VARCHAR(100) NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TreasureHuntCapture_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "XpTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "sourceType" "XpSourceType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "XpTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserXpBalance" (
    "userId" TEXT NOT NULL,
    "total" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserXpBalance_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "TreasureHuntAuditLog" (
    "id" TEXT NOT NULL,
    "huntId" TEXT,
    "locationId" TEXT,
    "actorUserId" TEXT NOT NULL,
    "action" VARCHAR(100) NOT NULL,
    "metadata" JSONB,
    "requestId" VARCHAR(255),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TreasureHuntAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TreasureHunt_featuredSlot_key" ON "TreasureHunt"("featuredSlot");
CREATE UNIQUE INDEX "TreasureHunt_eventKey_key" ON "TreasureHunt"("eventKey");
CREATE INDEX "TreasureHunt_status_startsAt_endsAt_idx" ON "TreasureHunt"("status", "startsAt", "endsAt");
CREATE INDEX "TreasureHunt_createdAt_idx" ON "TreasureHunt"("createdAt");

CREATE UNIQUE INDEX "TreasureHuntLocation_publicTokenHash_key" ON "TreasureHuntLocation"("publicTokenHash");
CREATE UNIQUE INDEX "TreasureHuntLocation_huntId_sortOrder_key" ON "TreasureHuntLocation"("huntId", "sortOrder");
CREATE INDEX "TreasureHuntLocation_huntId_isEnabled_sortOrder_idx" ON "TreasureHuntLocation"("huntId", "isEnabled", "sortOrder");

CREATE UNIQUE INDEX "TreasureHuntBitlyPublication_locationId_key" ON "TreasureHuntBitlyPublication"("locationId");
CREATE UNIQUE INDEX "TreasureHuntBitlyPublication_bitlinkId_key" ON "TreasureHuntBitlyPublication"("bitlinkId");
CREATE UNIQUE INDEX "TreasureHuntBitlyPublication_bitlinkUrl_key" ON "TreasureHuntBitlyPublication"("bitlinkUrl");
CREATE UNIQUE INDEX "TreasureHuntBitlyPublication_qrCodeId_key" ON "TreasureHuntBitlyPublication"("qrCodeId");
CREATE INDEX "TreasureHuntBitlyPublication_status_nextRetryAt_idx" ON "TreasureHuntBitlyPublication"("status", "nextRetryAt");
CREATE INDEX "TreasureHuntBitlyPublication_leaseExpiresAt_idx" ON "TreasureHuntBitlyPublication"("leaseExpiresAt");

CREATE UNIQUE INDEX "TreasureHuntClaim_userId_locationId_key" ON "TreasureHuntClaim"("userId", "locationId");
CREATE INDEX "TreasureHuntClaim_userId_claimedAt_idx" ON "TreasureHuntClaim"("userId", "claimedAt");
CREATE INDEX "TreasureHuntClaim_locationId_claimedAt_idx" ON "TreasureHuntClaim"("locationId", "claimedAt");

CREATE UNIQUE INDEX "TreasureHuntCapture_claimId_key" ON "TreasureHuntCapture"("claimId");
CREATE UNIQUE INDEX "TreasureHuntCapture_objectPath_key" ON "TreasureHuntCapture"("objectPath");

CREATE UNIQUE INDEX "XpTransaction_sourceType_sourceId_key" ON "XpTransaction"("sourceType", "sourceId");
CREATE INDEX "XpTransaction_userId_createdAt_idx" ON "XpTransaction"("userId", "createdAt");

CREATE INDEX "TreasureHuntAuditLog_huntId_createdAt_idx" ON "TreasureHuntAuditLog"("huntId", "createdAt");
CREATE INDEX "TreasureHuntAuditLog_actorUserId_createdAt_idx" ON "TreasureHuntAuditLog"("actorUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "TreasureHunt" ADD CONSTRAINT "TreasureHunt_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TreasureHunt" ADD CONSTRAINT "TreasureHunt_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TreasureHuntLocation" ADD CONSTRAINT "TreasureHuntLocation_huntId_fkey" FOREIGN KEY ("huntId") REFERENCES "TreasureHunt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TreasureHuntBitlyPublication" ADD CONSTRAINT "TreasureHuntBitlyPublication_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "TreasureHuntLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TreasureHuntClaim" ADD CONSTRAINT "TreasureHuntClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TreasureHuntClaim" ADD CONSTRAINT "TreasureHuntClaim_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "TreasureHuntLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TreasureHuntCapture" ADD CONSTRAINT "TreasureHuntCapture_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "TreasureHuntClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "XpTransaction" ADD CONSTRAINT "XpTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UserXpBalance" ADD CONSTRAINT "UserXpBalance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TreasureHuntAuditLog" ADD CONSTRAINT "TreasureHuntAuditLog_huntId_fkey" FOREIGN KEY ("huntId") REFERENCES "TreasureHunt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TreasureHuntAuditLog" ADD CONSTRAINT "TreasureHuntAuditLog_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "TreasureHuntLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TreasureHuntAuditLog" ADD CONSTRAINT "TreasureHuntAuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Keep the XP ledger append-only. Corrections must use compensating rows.
CREATE OR REPLACE FUNCTION "prevent_xp_transaction_mutation"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'XpTransaction rows are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "XpTransaction_immutable"
BEFORE UPDATE OR DELETE ON "XpTransaction"
FOR EACH ROW EXECUTE FUNCTION "prevent_xp_transaction_mutation"();

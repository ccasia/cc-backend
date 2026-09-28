

-- CreateTable
CREATE TABLE "CreatorDiscoveryProfile" (
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
    "scrapeDetails" JSONB,
    "captions" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "CreatorDiscoveryProfile_pkey" PRIMARY KEY ("id")
);


-- CreateIndex
CREATE INDEX "CreatorDiscoveryProfile_platform_idx" ON "CreatorDiscoveryProfile"("platform");


-- CreateIndex
CREATE UNIQUE INDEX "CreatorDiscoveryProfile_userId_platform_key" ON "CreatorDiscoveryProfile"("userId", "platform");


-- AddForeignKey
ALTER TABLE "CreatorDiscoveryProfile" ADD CONSTRAINT "CreatorDiscoveryProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Creator"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

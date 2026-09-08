-- Engagement rate for a platform creator with no connected account.
-- Additive and nullable: an existing row keeps NULL, which means "never
-- measured" and is deliberately not 0. DOUBLE PRECISION matches
-- "InstagramUser"."engagement_rate" and "TiktokUser"."engagement_rate".

-- AlterTable
ALTER TABLE "Creator" ADD COLUMN     "manualInstagramEngagementRate" DOUBLE PRECISION,
ADD COLUMN     "manualTiktokEngagementRate" DOUBLE PRECISION;

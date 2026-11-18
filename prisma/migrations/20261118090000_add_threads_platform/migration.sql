ALTER TYPE "SocialPlatform" ADD VALUE IF NOT EXISTS 'threads';
ALTER TABLE "Creator" ADD COLUMN "threadsProfileLink" VARCHAR(255);

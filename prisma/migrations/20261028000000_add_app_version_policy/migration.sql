-- CreateEnum
CREATE TYPE "AppPlatform" AS ENUM ('IOS', 'ANDROID');

-- CreateTable
CREATE TABLE "AppVersionPolicy" (
    "platform" "AppPlatform" NOT NULL,
    "minimumVersion" TEXT NOT NULL,
    "latestVersion" TEXT NOT NULL,
    "storeUrl" TEXT NOT NULL,
    "message" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "AppVersionPolicy_pkey" PRIMARY KEY ("platform")
);

-- AddForeignKey
ALTER TABLE "AppVersionPolicy" ADD CONSTRAINT "AppVersionPolicy_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed: 1.0.0 everywhere = no prompts until someone raises the values
INSERT INTO "AppVersionPolicy" ("platform", "minimumVersion", "latestVersion", "storeUrl", "updatedAt") VALUES
    ('IOS', '1.0.0', '1.0.0', 'https://apps.apple.com/app/id6768576494', CURRENT_TIMESTAMP),
    ('ANDROID', '1.0.0', '1.0.0', 'https://play.google.com/store/apps/details?id=com.cultcreative.app', CURRENT_TIMESTAMP);

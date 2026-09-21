ALTER TABLE "User" ADD COLUMN "hasAcceptedTermsAndPrivacy" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "pending_social_signups" (
    "id" TEXT NOT NULL,
    "provider" VARCHAR(16) NOT NULL,
    "providerSubject" VARCHAR(255) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "name" VARCHAR(255),
    "tokenHash" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pending_social_signups_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pending_social_signups_tokenHash_key" ON "pending_social_signups"("tokenHash");
CREATE UNIQUE INDEX "pending_social_signups_provider_providerSubject_key" ON "pending_social_signups"("provider", "providerSubject");
CREATE INDEX "pending_social_signups_expiresAt_idx" ON "pending_social_signups"("expiresAt");

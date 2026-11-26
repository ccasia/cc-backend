-- AlterTable
ALTER TABLE "SubmissionPostingUrl" ADD COLUMN "approvedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "SubmissionPostingUrl_approvedAt_idx" ON "SubmissionPostingUrl"("approvedAt");

-- Backfill posted links so links approved in the last 7 days keep their scrape window.
-- The later of createdAt and postingDate matches the window the code used before this column.
UPDATE "SubmissionPostingUrl" AS u
SET "approvedAt" = GREATEST(u."createdAt", COALESCE(u."postingDate", u."createdAt"))
FROM "Submission" AS s
WHERE s."id" = u."submissionId" AND s."status" = 'POSTED';

-- AlterTable
ALTER TABLE "DailyPostEngagementSnapshot" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'api';

-- AlterTable
ALTER TABLE "SubmissionPostingUrl" ADD COLUMN     "metricsScrapeFailure" JSONB,
ADD COLUMN     "metricsScrapeStatus" TEXT,
ADD COLUMN     "metricsScrapedAt" TIMESTAMP(3),
ADD COLUMN     "thumbnailUrl" TEXT;

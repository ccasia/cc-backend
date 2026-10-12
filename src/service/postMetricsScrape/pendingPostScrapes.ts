import { prisma } from '@/src/prisma/prisma';
import type { ScrapeFailure } from './postMetricsScrapeService';

/**
 * A status older than this is treated as stuck (for example, the worker
 * restarted mid-job), so the analytics page never shimmers forever.
 */
const PENDING_MAX_AGE_MS = 15 * 60_000;

export interface PendingPostScrape {
  submissionId: string;
  postUrl: string;
  platform: string;
  status: 'QUEUED' | 'RUNNING';
  /** When the scrape started, or when it was queued. */
  startedAt: Date;
}

/** Links of a campaign whose Bright Data scrape is queued or running. */
export async function getPendingPostScrapes(campaignId: string): Promise<PendingPostScrape[]> {
  const rows = await prisma.submissionPostingUrl.findMany({
    where: {
      campaignId,
      metricsScrapeStatus: { in: ['QUEUED', 'RUNNING'] },
      updatedAt: { gte: new Date(Date.now() - PENDING_MAX_AGE_MS) },
    },
    select: {
      submissionId: true,
      postUrl: true,
      platform: true,
      metricsScrapeStatus: true,
      metricsScrapedAt: true,
      updatedAt: true,
    },
  });

  return rows.map((row) => ({
    submissionId: row.submissionId,
    postUrl: row.postUrl,
    platform: row.platform,
    status: row.metricsScrapeStatus as PendingPostScrape['status'],
    startedAt: row.metricsScrapedAt ?? row.updatedAt,
  }));
}

export interface FailedPostScrape {
  postingUrlId: string;
  submissionId: string;
  postUrl: string;
  platform: string;
  thumbnailUrl: string | null;
  failure: ScrapeFailure | null;
}

/** Links of a campaign whose scrape FAILED, with the reason and any counters it did get. */
export async function getFailedPostScrapes(campaignId: string): Promise<FailedPostScrape[]> {
  const rows = await prisma.submissionPostingUrl.findMany({
    where: { campaignId, metricsScrapeStatus: 'FAILED', submission: { status: 'POSTED' } },
    select: {
      id: true,
      submissionId: true,
      postUrl: true,
      platform: true,
      thumbnailUrl: true,
      metricsScrapeFailure: true,
    },
  });

  return rows.map((row) => ({
    postingUrlId: row.id,
    submissionId: row.submissionId,
    postUrl: row.postUrl,
    platform: row.platform,
    thumbnailUrl: row.thumbnailUrl,
    failure: row.metricsScrapeFailure as unknown as ScrapeFailure | null,
  }));
}

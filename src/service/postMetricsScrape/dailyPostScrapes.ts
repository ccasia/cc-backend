import { prisma } from '@/src/prisma/prisma';
import { CONNECTION_SELECT, isPlatformConnected } from './planPostScrapes';
import { isCurrentLink } from './postMetricsScrapeService';
import { queuePostScrape } from './queuePostScrape';
import { isInScrapeWindow, isUnderFailureLimit, notScrapedToday, scrapeDay } from './scrapeDay';

const QUEUE_BATCH_SIZE = 10;

export interface DailyScrapeResult {
  evaluated: number;
  queued: number;
}

/**
 * Queues today's Bright Data scrape for every posted link of a creator with
 * no connected account, from the approval day until the campaign period ends.
 * Each scrape writes the day's snapshot, which fills the report's heatmap and
 * daily views. Connected creators are read by the API cron instead.
 */
export async function queueDailyPostScrapes(now: Date = new Date()): Promise<DailyScrapeResult> {
  const today = scrapeDay(now);

  const rows = await prisma.submissionPostingUrl.findMany({
    where: {
      postingDate: { not: null, lt: today.add(1, 'day').toDate() },
      ...notScrapedToday(now),
      submission: { status: 'POSTED' },
      campaign: {
        status: { in: ['ACTIVE', 'COMPLETED'] },
        // The run after the last day also counts; one more day of slack, as the exact day is checked in Malaysia time below.
        campaignBrief: { endDate: { gte: today.subtract(2, 'day').toDate() } },
      },
    },
    select: {
      id: true,
      campaignId: true,
      submissionId: true,
      platform: true,
      postUrl: true,
      shortCode: true,
      mediaId: true,
      postingDate: true,
      metricsScrapeFailure: true,
      campaign: { select: { campaignBrief: { select: { endDate: true } } } },
      submission: { select: { content: true, user: { select: { creator: { select: CONNECTION_SELECT } } } } },
    },
  });

  const due = rows.filter(
    (row) =>
      isInScrapeWindow(row.postingDate, row.campaign.campaignBrief?.endDate, now) &&
      isCurrentLink(row) &&
      isUnderFailureLimit(row.metricsScrapeFailure) &&
      !isPlatformConnected(row.submission.user?.creator, row.platform),
  );

  let queued = 0;
  for (let i = 0; i < due.length; i += QUEUE_BATCH_SIZE) {
    const batch = due.slice(i, i + QUEUE_BATCH_SIZE);
    // eslint-disable-next-line no-await-in-loop
    const results = await Promise.allSettled(
      batch.map((row) =>
        queuePostScrape({ postingUrlId: row.id, campaignId: row.campaignId, submissionId: row.submissionId }, now),
      ),
    );
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') queued++;
      else console.error(`[daily-post-scrape] Failed to queue ${batch[index].id}:`, (result.reason as Error)?.message);
    });
  }

  return { evaluated: rows.length, queued };
}

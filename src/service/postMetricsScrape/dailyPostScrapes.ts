import { prisma } from '@/src/prisma/prisma';
import { CONNECTION_SELECT, isPlatformConnected } from './planPostScrapes';
import { queuePostScrape } from './queuePostScrape';
import { isInScrapeWindow, notScrapedToday, scrapeDay } from './scrapeDay';

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
        // One day of slack: the exact end day is checked in Malaysia time below.
        campaignBrief: { endDate: { gte: today.subtract(1, 'day').toDate() } },
      },
    },
    select: {
      id: true,
      campaignId: true,
      submissionId: true,
      platform: true,
      postingDate: true,
      campaign: { select: { campaignBrief: { select: { endDate: true } } } },
      submission: { select: { user: { select: { creator: { select: CONNECTION_SELECT } } } } },
    },
  });

  const due = rows.filter(
    (row) =>
      isInScrapeWindow(row.postingDate, row.campaign.campaignBrief?.endDate, now) &&
      !isPlatformConnected(row.submission.user?.creator, row.platform),
  );

  let queued = 0;
  for (const row of due) {
    try {
      await queuePostScrape({ postingUrlId: row.id, campaignId: row.campaignId, submissionId: row.submissionId });
      queued++;
    } catch (error) {
      console.error(`[daily-post-scrape] Failed to queue ${row.id}:`, (error as Error).message);
    }
  }

  return { evaluated: rows.length, queued };
}

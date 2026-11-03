import { enqueuePostScrape, type PostScrapeJobData } from '@utils/queue';
import { prisma } from '@/src/prisma/prisma';
import { notScrapedToday, scrapeDayKey } from './scrapeDay';

/**
 * Marks a link QUEUED, so campaign analytics shows its shimmer even after a
 * refresh, then puts the scrape on the queue. A link already scraped today
 * is left alone; the worker would skip it anyway. A run from yesterday that
 * is still going keeps its RUNNING status, but today's run is still queued.
 */
export async function queuePostScrape(data: PostScrapeJobData, now: Date = new Date()): Promise<void> {
  const free = await prisma.submissionPostingUrl.findFirst({
    where: { id: data.postingUrlId, ...notScrapedToday(now) },
    select: { metricsScrapeStatus: true },
  });
  if (!free) return;
  if (free.metricsScrapeStatus !== 'RUNNING') {
    await prisma.submissionPostingUrl.updateMany({
      where: { id: data.postingUrlId, ...notScrapedToday(now) },
      data: { metricsScrapeStatus: 'QUEUED' },
    });
  }
  await enqueuePostScrape(data, scrapeDayKey(now));
}

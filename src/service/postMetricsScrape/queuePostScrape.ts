import { enqueuePostScrape, type PostScrapeJobData } from '@utils/queue';
import { prisma } from '@/src/prisma/prisma';
import { notScrapedToday } from './scrapeDay';

/**
 * Marks a link QUEUED, so campaign analytics shows its shimmer even after a
 * refresh, then puts the scrape on the queue. A link already scraped today
 * is left alone; the worker would skip it anyway.
 */
export async function queuePostScrape(data: PostScrapeJobData): Promise<void> {
  const marked = await prisma.submissionPostingUrl.updateMany({
    where: { id: data.postingUrlId, ...notScrapedToday(new Date()) },
    data: { metricsScrapeStatus: 'QUEUED' },
  });
  if (marked.count === 0) return;
  await enqueuePostScrape(data);
}

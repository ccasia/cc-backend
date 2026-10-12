import { enqueuePostScrape, type PostScrapeJobData } from '@utils/queue';
import { prisma } from '@/src/prisma/prisma';

/**
 * Marks a link QUEUED, so campaign analytics shows its shimmer even after a
 * refresh, then puts the scrape on the queue. A link that was already scraped
 * is left alone; the worker would skip it anyway.
 */
export async function queuePostScrape(data: PostScrapeJobData): Promise<void> {
  const marked = await prisma.submissionPostingUrl.updateMany({
    where: { id: data.postingUrlId, metricsScrapedAt: null },
    data: { metricsScrapeStatus: 'QUEUED' },
  });
  if (marked.count === 0) return;
  await enqueuePostScrape(data);
}

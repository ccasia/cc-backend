import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

/** Snapshots, claims and the campaign window all count days in Malaysia time. */
export const scrapeDay = (date: Date) => dayjs(date).tz('Asia/Kuala_Lumpur').startOf('day');

/**
 * A link is scraped at most once a day. `metricsScrapedAt` holds its last
 * claim, so a claim from before today's start leaves the link free.
 */
export const notScrapedToday = (now: Date) => ({
  OR: [{ metricsScrapedAt: null }, { metricsScrapedAt: { lt: scrapeDay(now).toDate() } }],
});

/**
 * A link is scraped every day from the day its posting link was approved
 * until the last day of the campaign period, both days included.
 */
export function isInScrapeWindow(
  postingDate: Date | null | undefined,
  campaignEndDate: Date | null | undefined,
  now: Date,
): boolean {
  if (!postingDate || !campaignEndDate) return false;
  const today = scrapeDay(now);
  return !today.isBefore(scrapeDay(postingDate)) && !today.isAfter(scrapeDay(campaignEndDate));
}

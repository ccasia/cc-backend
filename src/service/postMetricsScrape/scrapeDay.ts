import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

/** Snapshots, claims and the campaign window all count days in Malaysia time. */
export const scrapeDay = (date: Date) => dayjs(date).tz('Asia/Kuala_Lumpur').startOf('day');

/** Names a link's scrape for one day, so a run left from yesterday never blocks today's. */
export const scrapeDayKey = (date: Date) => scrapeDay(date).format('YYYYMMDD');

/**
 * A link is scraped at most once a day. `metricsScrapedAt` holds its last
 * claim, so a claim from before today's start leaves the link free.
 */
export const notScrapedToday = (now: Date) => ({
  OR: [{ metricsScrapedAt: null }, { metricsScrapedAt: { lt: scrapeDay(now).toDate() } }],
});

export const wasScrapedToday = (scrapedAt: Date | null | undefined, now: Date): boolean =>
  !!scrapedAt && !dayjs(scrapedAt).isBefore(scrapeDay(now));

/**
 * A link is scraped every day from the day its posting link was approved
 * until the campaign's last day. The 12 AM run after that day also counts,
 * because it is the run that reads the last day's final totals.
 */
export function isInScrapeWindow(
  postingDate: Date | null | undefined,
  campaignEndDate: Date | null | undefined,
  now: Date,
): boolean {
  if (!postingDate || !campaignEndDate) return false;
  const today = scrapeDay(now);
  return !today.isBefore(scrapeDay(postingDate)) && !today.isAfter(scrapeDay(campaignEndDate).add(1, 'day'));
}

/**
 * A post that cannot be read (deleted, private, no views) fails every day and
 * each try is billed. After this many failed days in a row it is not queued
 * again; an admin can still complete it by hand, which resets the count.
 */
export const MAX_FAILED_SCRAPE_DAYS = 3;

/** Failed days in a row, read from `metricsScrapeFailure`. A failure from before the count existed is 1. */
export const failedScrapeDays = (failure: unknown): number => {
  if (!failure || typeof failure !== 'object') return 0;
  const { streak } = failure as { streak?: unknown };
  return typeof streak === 'number' ? streak : 1;
};

export const isUnderFailureLimit = (failure: unknown): boolean => failedScrapeDays(failure) < MAX_FAILED_SCRAPE_DAYS;

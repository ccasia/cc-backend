import { parsePublishedAt } from '@services/guestProfileExtraction/validPostPolicy';
import { isCurrentLink } from '@services/postMetricsScrape/postMetricsScrapeService';

interface PostingUrlDate {
  postUrl: string;
  shortCode: string | null;
  mediaId: string | null;
  postingDate: Date | null;
}

/**
 * The posting date of the submission's current link. A replaced link keeps its
 * row and its old date, so the oldest row is not always the live post.
 * `urls` is oldest first; with no current match, the oldest dated row is used.
 */
export function currentPostingDate(urls: PostingUrlDate[], content: string | null): Date | null {
  const dated = urls.filter((url) => url.postingDate);
  const current = dated.find((url) => isCurrentLink({ ...url, submission: { content } }));
  return (current ?? dated[0])?.postingDate ?? null;
}

/** Instagram Graph `timestamp`, e.g. "2026-10-31T07:39:49+0000". Null when missing or unusable. */
export function instagramPublishedAt(timestamp: unknown, now: Date = new Date()): Date | null {
  return typeof timestamp === 'string' ? parsePublishedAt(timestamp, now.getTime()) : null;
}

interface PostingDateStore {
  updateMany(args: unknown): Promise<unknown>;
}

/**
 * Saves each post's platform publish date as its posting date. `urls[i]` and
 * `results[i]` are the same post. `urls` is updated in place, so the snapshots
 * written after this count days from the real date. A failed write keeps the
 * stored date and never fails the metrics.
 */
export async function savePublishedDates(
  store: PostingDateStore,
  urls: { id: string; postingDate: Date | null }[],
  results: { publishedAt?: Date | null; error?: string }[],
): Promise<number> {
  let saved = 0;
  for (let i = 0; i < urls.length; i++) {
    const result = results[i];
    const publishedAt = result && !result.error ? result.publishedAt : null;
    if (!publishedAt || publishedAt.getTime() === urls[i].postingDate?.getTime()) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      await store.updateMany({ where: { id: urls[i].id }, data: { postingDate: publishedAt } });
      urls[i].postingDate = publishedAt;
      saved++;
    } catch (error) {
      console.error(`Post date not saved for posting URL ${urls[i].id}:`, (error as Error).message);
    }
  }
  return saved;
}

/** TikTok API `create_time`, in Unix seconds. Null when missing or unusable. */
export function tiktokPublishedAt(createTime: unknown, now: Date = new Date()): Date | null {
  const seconds = typeof createTime === 'string' && /^\d+$/.test(createTime) ? Number(createTime) : createTime;
  if (typeof seconds !== 'number' || !Number.isSafeInteger(seconds) || seconds <= 0) return null;
  return parsePublishedAt(new Date(seconds * 1000).toISOString(), now.getTime());
}

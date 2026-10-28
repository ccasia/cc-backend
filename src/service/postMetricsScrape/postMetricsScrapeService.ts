import {
  POST_SCRAPERS,
  REEL_VIEWS_LOOKUP_POSTS,
  SCRAPERS,
  type ScraperJob,
} from '@configs/guestProfileExtractionConfig';
import type { ScraperGateway } from '@services/guestProfileExtraction/brightDataGateway';
import { Prisma } from '@prisma/client';

import {
  findReelViews,
  parsePostMetrics,
  postThumbnail,
  scrapedEngagementRate,
  type PostMetrics,
} from './postMetricsAdapter';
import { failedScrapeDays, notScrapedToday, scrapeDay } from './scrapeDay';

const { DbNull } = Prisma;

/**
 * Scrapes one approved post with Bright Data and stores it as a daily
 * snapshot, so campaign analytics lists creators with no connected account.
 *
 * A post is scraped at most once a day, from approval until the campaign
 * ends (see dailyPostScrapes). `SubmissionPostingUrl.metricsScrapedAt` is
 * claimed before the paid job starts, so a second enqueue on the same day
 * (approval, the daily cron, the API-failure fallback) does nothing. The claim
 * is given back only when Bright Data definitely started no job.
 *
 * An Instagram Reel takes two jobs: the post itself (likes, comments, owner),
 * then a Reels discovery of the owner for its views. See POST_SCRAPERS.
 */

export type ScrapeOutcome =
  | 'SCRAPED'
  | 'SKIPPED_NOT_FOUND'
  | 'SKIPPED_NOT_POSTED'
  | 'SKIPPED_ALREADY_SCRAPED'
  | 'SKIPPED_STALE_LINK'
  | 'SKIPPED_API_ROW_TODAY'
  | 'RATE_LIMITED'
  | 'START_REFUSED'
  | 'START_AMBIGUOUS'
  | 'JOB_FAILED'
  | 'TIMED_OUT'
  | 'PARSE_FAILED'
  | 'REEL_VIEWS_NOT_FOUND';

interface PostingUrlRow {
  id: string;
  campaignId: string;
  submissionId: string;
  platform: string;
  postUrl: string;
  postingDate: Date | null;
  shortCode: string | null;
  mediaId: string | null;
  metricsScrapedAt?: Date | null;
  metricsScrapeStatus?: string | null;
  metricsScrapeFailure?: unknown;
  submission: { userId: string; status: string; content: string | null };
}

export interface PostScrapeStore {
  submissionPostingUrl: {
    findUnique(args: unknown): Promise<PostingUrlRow | null>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  dailyPostEngagementSnapshot: {
    findUnique(args: unknown): Promise<{ source: string } | null>;
    upsert(args: unknown): Promise<unknown>;
  };
}

export interface PostScrapeDeps {
  store: PostScrapeStore;
  gateway: ScraperGateway;
  pollTimeoutMs: number;
  /** A Reels discovery takes 1-7 minutes, far longer than one post. */
  discoveryPollTimeoutMs: number;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  log?: (message: string, context?: Record<string, unknown>) => void;
  /** Copies a provider thumbnail to our bucket. Provider URLs expire and cannot be hotlinked. */
  cacheThumbnail?: (sourceUrl: string, platform: string, postId: string) => Promise<string | null>;
}

const DEFAULT_POLL_INTERVAL_MS = 5_000;

/**
 * Rejected links keep their SubmissionPostingUrl row; only `content` changes.
 * A row is current when the submission's content still names its post.
 */
export const isCurrentLink = (
  row: Pick<PostingUrlRow, 'postUrl' | 'shortCode' | 'mediaId'> & { submission: { content: string | null } },
): boolean => {
  const content = row.submission.content ?? '';
  return [row.postUrl, row.shortCode, row.mediaId].some((value) => !!value && content.includes(value));
};

/** Bright Data's post scraper answers `dead_page` for `/reels/` and `/tv/` links, so it gets the `/reel/` form. */
const scrapeUrl = (row: PostingUrlRow): string =>
  row.platform === 'TikTok' ? row.postUrl : row.postUrl.replace(/\/(?:reels|tv)\//i, '/reel/');

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Why a scrape ended FAILED, kept on `SubmissionPostingUrl.metricsScrapeFailure`
 * so analytics can show the reason. `partial` holds the counters that did come
 * back (an Instagram Reel whose views were not found), so an admin only enters
 * what is missing.
 */
export interface ScrapeFailure {
  code: ScrapeOutcome | 'ERROR';
  message: string;
  jobIds: string[];
  partial: PostMetrics | null;
  at: string;
  /** Failed days in a row. The daily cron stops at MAX_FAILED_SCRAPE_DAYS. */
  streak?: number;
}

/**
 * What a run learns before it ends. `priorFailure` is the link's failure from
 * its last run, if that run failed. `claimedAt` is set once this run owns the link.
 */
type FailureNote = Pick<ScrapeFailure, 'message' | 'jobIds' | 'partial'> & { priorFailure?: unknown; claimedAt?: Date };

type JobRun =
  | { ok: true; jobId: string; items: unknown[] }
  | { ok: false; outcome: ScrapeOutcome; refused: boolean; message: string; jobId?: string };

/**
 * The link's analytics status after a run. `undefined` leaves it as it is:
 * an already-claimed link belongs to the run that claimed it. `null` clears
 * it, because no paid job ran and the link may be queued again later.
 */
const STATUS_AFTER: Partial<Record<ScrapeOutcome, string | null | undefined>> = {
  SCRAPED: 'SCRAPED',
  SKIPPED_ALREADY_SCRAPED: undefined,
  SKIPPED_NOT_FOUND: undefined,
  SKIPPED_NOT_POSTED: null,
  SKIPPED_STALE_LINK: null,
  SKIPPED_API_ROW_TODAY: null,
  START_REFUSED: null,
  RATE_LIMITED: null,
};

const statusAfter = (outcome: ScrapeOutcome): string | null | undefined =>
  outcome in STATUS_AFTER ? STATUS_AFTER[outcome] : 'FAILED';

export async function scrapePostMetrics(postingUrlId: string, deps: PostScrapeDeps): Promise<ScrapeOutcome> {
  const now = deps.now ?? (() => new Date());
  const note: FailureNote = { message: '', jobIds: [], partial: null };
  const toFailure = (code: ScrapeFailure['code'], message = note.message): ScrapeFailure => ({
    code,
    message,
    jobIds: note.jobIds,
    partial: note.partial,
    at: now().toISOString(),
    streak: failedScrapeDays(note.priorFailure) + 1,
  });
  // Once claimed, only this run's claim is updated: yesterday's run ending late must not overwrite today's.
  const setStatus = (metricsScrapeStatus: string | null, failure: ScrapeFailure | null) =>
    deps.store.submissionPostingUrl.updateMany({
      where: note.claimedAt ? { id: postingUrlId, metricsScrapedAt: note.claimedAt } : { id: postingUrlId },
      data: { metricsScrapeStatus, metricsScrapeFailure: failure ?? DbNull },
    });

  let outcome: ScrapeOutcome;
  try {
    outcome = await runScrape(postingUrlId, deps, note);
  } catch (error) {
    await setStatus('FAILED', toFailure('ERROR', (error as Error).message)).catch(() => undefined);
    throw error;
  }
  const status = statusAfter(outcome);
  if (status === 'FAILED') {
    const failure = toFailure(outcome);
    deps.log?.('Post scrape failed', { postingUrlId, ...failure });
    await setStatus(status, failure);
  } else if (status !== undefined) {
    await setStatus(status, null);
  }
  return outcome;
}

/**
 * Writes the day's `brightdata` snapshot for a link. Shared by the scrape and an admin's manual completion.
 * `snapshotOn` is the claim time, so a run that ends after midnight still fills the day it was started for.
 */
async function writeSnapshot(
  store: PostScrapeStore,
  row: PostingUrlRow,
  metrics: PostMetrics,
  rawMetrics: Record<string, unknown>,
  capturedAt: Date,
  snapshotOn: Date = capturedAt,
): Promise<void> {
  const snapshotDate = scrapeDay(snapshotOn);
  const postDate = scrapeDay(row.postingDate ?? capturedAt);
  const values = {
    daysSincePost: snapshotDate.diff(postDate, 'day'),
    capturedAt,
    ...metrics,
    reach: metrics.views,
    engagementRate: scrapedEngagementRate(metrics),
    rawMetrics,
    source: 'brightdata',
  };
  await store.dailyPostEngagementSnapshot.upsert({
    where: { postUrl_snapshotDate: { postUrl: row.postUrl, snapshotDate: snapshotDate.toDate() } },
    create: {
      campaignId: row.campaignId,
      submissionId: row.submissionId,
      postUrl: row.postUrl,
      platform: row.platform,
      userId: row.submission.userId,
      postDate: postDate.toDate(),
      snapshotDate: snapshotDate.toDate(),
      ...values,
    },
    update: values,
  });
}

/** A failed copy only loses the picture, never the metrics. */
async function saveThumbnail(deps: PostScrapeDeps, row: PostingUrlRow, sourceUrl: string | null): Promise<void> {
  if (!sourceUrl || !deps.cacheThumbnail) return;
  try {
    const thumbnailUrl = await deps.cacheThumbnail(sourceUrl, row.platform.toLowerCase(), `analytics-${row.id}`);
    if (thumbnailUrl) {
      await deps.store.submissionPostingUrl.updateMany({ where: { id: row.id }, data: { thumbnailUrl } });
    }
  } catch (error) {
    deps.log?.('Post thumbnail copy failed', { postingUrlId: row.id, message: (error as Error).message });
  }
}

async function runScrape(postingUrlId: string, deps: PostScrapeDeps, note: FailureNote): Promise<ScrapeOutcome> {
  const { store, gateway } = deps;
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => undefined);
  const pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  const row = await store.submissionPostingUrl.findUnique({
    where: { id: postingUrlId },
    include: { submission: { select: { userId: true, status: true, content: true } } },
  });
  if (!row) return 'SKIPPED_NOT_FOUND';
  note.priorFailure = row.metricsScrapeFailure;
  if (row.submission.status !== 'POSTED') return 'SKIPPED_NOT_POSTED';
  if (!isCurrentLink(row)) return 'SKIPPED_STALE_LINK';

  const claimedAt = now();
  const snapshotKey = {
    postUrl_snapshotDate: { postUrl: row.postUrl, snapshotDate: scrapeDay(claimedAt).toDate() },
  };
  // The API already read this post today and has real shares and saves. Never pay to overwrite them.
  const today = await store.dailyPostEngagementSnapshot.findUnique({ where: snapshotKey, select: { source: true } });
  if (today?.source === 'api') return 'SKIPPED_API_ROW_TODAY';

  const claimed = await store.submissionPostingUrl.updateMany({
    where: { id: postingUrlId, ...notScrapedToday(claimedAt) },
    data: { metricsScrapedAt: claimedAt, metricsScrapeStatus: 'RUNNING' },
  });
  if (claimed.count === 0) return 'SKIPPED_ALREADY_SCRAPED';
  note.claimedAt = claimedAt;

  const platform = row.platform === 'TikTok' ? 'tiktok' : 'instagram';
  const context = { postingUrlId, postUrl: row.postUrl, platform };

  /** Start one job, poll it to the end, and read its items. Never retries a start. */
  const runJob = async (job: ScraperJob, input: Record<string, unknown>[], timeoutMs: number): Promise<JobRun> => {
    const started = await gateway.startJob({ ...job, input });
    if (!started.ok) {
      if (started.ambiguous) {
        // A job may exist and be billed. Keep the claim so nothing starts another.
        log('Post scrape start was ambiguous; not retried', { ...context, message: started.message });
        return {
          ok: false,
          outcome: 'START_AMBIGUOUS',
          refused: false,
          message: `Bright Data did not confirm the job start, so it was not retried: ${started.message}`,
        };
      }
      log('Post scrape start refused', { ...context, code: started.code, message: started.message });
      return {
        ok: false,
        outcome: started.code === 'RATE_LIMITED' ? 'RATE_LIMITED' : 'START_REFUSED',
        refused: true,
        message: started.message,
      };
    }

    const jobId = started.runId;
    const deadline = Date.now() + timeoutMs;
    let state = 'RUNNING';
    while (state === 'RUNNING') {
      if (Date.now() >= deadline) {
        await gateway.cancelJob(jobId);
        log('Post scrape timed out and was canceled', { ...context, jobId });
        return {
          ok: false,
          outcome: 'TIMED_OUT',
          refused: false,
          jobId,
          message: `The Bright Data job ran past ${Math.round(timeoutMs / 1000)}s and was canceled.`,
        };
      }
      // eslint-disable-next-line no-await-in-loop
      await sleep(pollIntervalMs);
      // A failed progress read is not a failed job. Keep polling until the deadline.
      // eslint-disable-next-line no-await-in-loop
      const snapshot = await gateway.getJob(jobId).catch(() => ({ state: 'RUNNING' as const, errorMessage: null }));
      state = snapshot?.state ?? 'FAILED';
      if (state === 'FAILED' || state === 'CANCELLED') {
        const error = snapshot?.errorMessage ?? 'snapshot not found';
        log('Post scrape job failed', { ...context, jobId, error });
        return {
          ok: false,
          outcome: 'JOB_FAILED',
          refused: false,
          jobId,
          message: `The Bright Data job failed: ${error}`,
        };
      }
    }

    // A job that just turned ready can still answer "building". One re-read, never a new job.
    const items = await gateway.listItems(jobId).catch(async () => {
      await sleep(pollIntervalMs);
      return gateway.listItems(jobId);
    });
    return { ok: true, jobId, items };
  };

  const failWith = (run: Extract<JobRun, { ok: false }>): ScrapeOutcome => {
    note.message = run.message;
    if (run.jobId) note.jobIds.push(run.jobId);
    return run.outcome;
  };

  const postRun = await runJob(POST_SCRAPERS[platform], [{ url: scrapeUrl(row) }], deps.pollTimeoutMs);
  if (!postRun.ok) {
    // Nothing was billed, so give back today's claim and let a later enqueue try again.
    if (postRun.refused) {
      await store.submissionPostingUrl.updateMany({
        where: { id: postingUrlId, metricsScrapedAt: claimedAt },
        data: { metricsScrapedAt: row.metricsScrapedAt ?? null },
      });
      note.claimedAt = undefined;
    }
    return failWith(postRun);
  }
  note.jobIds.push(postRun.jobId);

  const parsed = parsePostMetrics(platform, postRun.items);
  if (!parsed.ok) {
    log('Post scrape returned no usable metrics', {
      ...context,
      jobId: postRun.jobId,
      code: parsed.code,
      message: parsed.message,
    });
    note.message = `Bright Data returned no usable metrics (${parsed.code}): ${parsed.message}`;
    return 'PARSE_FAILED';
  }

  // Even when the views lookup below fails, the row can show the post.
  await saveThumbnail(deps, row, postThumbnail(platform, parsed.item));

  let { metrics } = parsed;

  if (parsed.reelLookup) {
    // Likes and comments are in hand. If the views lookup fails, an admin enters only the views.
    note.partial = metrics;
    const { owner, shortcode } = parsed.reelLookup;
    const reelsRun = await runJob(
      SCRAPERS.instagram.posts,
      [{ url: `https://www.instagram.com/${owner}`, num_of_posts: REEL_VIEWS_LOOKUP_POSTS }],
      deps.discoveryPollTimeoutMs,
    );
    // The post job is already paid for, so the claim stays even when this one is refused.
    if (!reelsRun.ok) return failWith(reelsRun);
    note.jobIds.push(reelsRun.jobId);

    const reel = findReelViews(reelsRun.items, shortcode);
    if (!reel) {
      // A Reel without views would show a false 0% rate. The admin enters it by hand instead.
      log('Reel views not found in the owner discovery', { ...context, owner, shortcode, jobIds: note.jobIds });
      note.message = `Instagram did not show this Reel's views. It is not among @${owner}'s ${REEL_VIEWS_LOOKUP_POSTS} newest Reels.`;
      return 'REEL_VIEWS_NOT_FOUND';
    }
    metrics = { ...metrics, ...reel };
  }

  // The jobs are paid for. If the write fails, the log keeps the numbers so they can be restored by hand.
  log('Post scraped', { ...context, jobIds: note.jobIds, ...metrics });
  await writeSnapshot(store, row, metrics, { jobIds: note.jobIds, item: parsed.item }, now(), claimedAt);
  return 'SCRAPED';
}

/**
 * A scrape whose worker died stays RUNNING forever: the claim blocks every
 * retry, so analytics shimmers and then shows nothing. Mark it FAILED so an
 * admin can enter the numbers. Never re-scraped here: its jobs may be billed.
 *
 * `ids` targets this process's own scrapes on shutdown. `claimedBefore` finds
 * scrapes older than any live run, left by a process that was killed.
 */
export async function failInterruptedScrapes(
  store: Pick<PostScrapeStore, 'submissionPostingUrl'>,
  filter: { ids: string[] } | { claimedBefore: Date },
  now: Date = new Date(),
): Promise<number> {
  const failure: ScrapeFailure = {
    code: 'ERROR',
    message: 'The worker stopped during this scrape, so its result was lost.',
    jobIds: [],
    partial: null,
    at: now.toISOString(),
  };
  const target = 'ids' in filter ? { id: { in: filter.ids } } : { metricsScrapedAt: { lt: filter.claimedBefore } };
  const { count } = await store.submissionPostingUrl.updateMany({
    where: { ...target, metricsScrapeStatus: 'RUNNING' },
    data: { metricsScrapeStatus: 'FAILED', metricsScrapeFailure: failure },
  });
  return count;
}

export type ManualMetricsInput = Partial<Record<keyof PostMetrics, number>>;

export type ManualCompletionResult =
  | { ok: true; metrics: PostMetrics }
  | { ok: false; status: 404 | 409 | 400; message: string };

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/**
 * An admin completes a FAILED scrape by hand. Counters the scrape did get stay
 * unless the admin overrides them; views, likes and comments are required.
 * Instagram shares and saves stay 0, as for any scraped Instagram post.
 */
export async function completeFailedScrape(
  store: PostScrapeStore,
  input: { campaignId: string; postingUrlId: string; metrics: ManualMetricsInput; adminId: string; now?: Date },
): Promise<ManualCompletionResult> {
  const row = await store.submissionPostingUrl.findUnique({
    where: { id: input.postingUrlId },
    include: { submission: { select: { userId: true, status: true, content: true } } },
  });
  if (!row || row.campaignId !== input.campaignId) return { ok: false, status: 404, message: 'Posting link not found' };
  if (row.metricsScrapeStatus !== 'FAILED') {
    return { ok: false, status: 409, message: 'Only a failed scrape can be completed by hand' };
  }

  const isInstagram = row.platform !== 'TikTok';
  const partial = (row.metricsScrapeFailure as ScrapeFailure | null)?.partial ?? null;
  const pick = (key: keyof PostMetrics) => input.metrics[key] ?? partial?.[key];
  const metrics = {
    views: pick('views'),
    likes: pick('likes'),
    comments: pick('comments'),
    shares: isInstagram ? 0 : (pick('shares') ?? 0),
    saved: 0,
  };
  if (!Object.values(metrics).every(isCount)) {
    return { ok: false, status: 400, message: 'Views, likes and comments must be whole numbers of 0 or more' };
  }

  const capturedAt = input.now ?? new Date();
  await writeSnapshot(
    store,
    row,
    metrics as PostMetrics,
    {
      manual: { by: input.adminId, at: capturedAt.toISOString(), entered: input.metrics },
      failure: row.metricsScrapeFailure,
    },
    capturedAt,
  );
  await store.submissionPostingUrl.updateMany({
    where: { id: row.id },
    data: { metricsScrapeStatus: 'SCRAPED', metricsScrapeFailure: DbNull },
  });
  return { ok: true, metrics: metrics as PostMetrics };
}

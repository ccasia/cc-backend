import { Prisma } from '@prisma/client';
import { prisma } from '@/src/prisma/prisma';
import { linkMatchesPostingUrl } from '@services/submissionUrlService';
import {
  completeFailedScrape,
  type PostScrapeStore,
  type ScrapeFailure,
} from '@services/postMetricsScrape/postMetricsScrapeService';
import { scrapedEngagementRate, type PostMetrics } from '@services/postMetricsScrape/postMetricsAdapter';
import { scrapeDay } from '@services/postMetricsScrape/scrapeDay';

/**
 * Insight screenshots update the post's analytics numbers. A number that is the same or higher
 * is applied at once. A lower number waits for an admin in `metricsReview.pending`, whoever uploaded it.
 */

type MetricKey = keyof PostMetrics;
export type Metrics = Partial<Record<MetricKey, number>>;

interface Actor {
  id: string;
  name: string | null;
  role: string;
}

export interface MetricsReview {
  pending?: { values: Metrics; current: Metrics; uploadedBy: Actor; at: string } | null;
  /** Lower numbers an admin chose not to use. The same number does not ask again. */
  dismissed?: Metrics;
}

/** OCR keys to analytics snapshot fields. */
const SCREENSHOT_KEYS: Record<string, MetricKey> = {
  views: 'views',
  likes: 'likes',
  comments: 'comments',
  shares: 'shares',
  saves: 'saved',
};

const METRIC_KEYS: MetricKey[] = ['views', 'likes', 'comments', 'shares', 'saved'];

type PostingRow = NonNullable<Awaited<ReturnType<typeof findPostingRow>>>;

const toMetrics = (source: Record<string, unknown> | null | undefined): Metrics =>
  Object.fromEntries(
    METRIC_KEYS.flatMap((key) => {
      const value = source?.[key];
      return typeof value === 'number' && Number.isFinite(value) ? [[key, value]] : [];
    }),
  );

export const screenshotMetrics = (values: Record<string, unknown>): Metrics =>
  Object.fromEntries(
    Object.entries(SCREENSHOT_KEYS).flatMap(([ocrKey, key]) => {
      const value = values[ocrKey];
      return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? [[key, Math.round(value)]] : [];
    }),
  );

/** Splits screenshot numbers into those to apply now and those lower than the current numbers. */
export const splitMetrics = (screenshot: Metrics, current: Metrics, dismissed: Metrics = {}) => {
  const apply: Metrics = {};
  const lower: Metrics = {};
  (Object.entries(screenshot) as [MetricKey, number][]).forEach(([key, value]) => {
    const now = current[key];
    if (now === undefined || value > now) apply[key] = value;
    else if (value < now && dismissed[key] !== value) lower[key] = value;
  });
  return { apply, lower };
};

const WITH_CREATOR = { submission: { select: { userId: true } } } as const;

const findPostingRow = async (campaignId: string, submissionId: string, postUrl: string) => {
  const rows = await prisma.submissionPostingUrl.findMany({
    where: { campaignId, submissionId },
    include: WITH_CREATOR,
  });
  return rows.find((row) => linkMatchesPostingUrl(row, postUrl)) ?? null;
};

/** The numbers the analytics row shows: the newest daily snapshot, or a newer milestone one. */
const latestSnapshot = async (row: PostingRow) => {
  const where = { campaignId: row.campaignId, postUrl: row.postUrl };
  const [daily, milestone] = await Promise.all([
    prisma.dailyPostEngagementSnapshot.findFirst({ where, orderBy: { snapshotDate: 'desc' } }),
    prisma.postEngagementSnapshot.findFirst({ where, orderBy: { capturedAt: 'desc' } }),
  ]);
  if (milestone && (!daily || milestone.capturedAt > daily.capturedAt)) return milestone;
  return daily;
};

const isFailed = (row: PostingRow) => row.metricsScrapeStatus === 'FAILED';

/** What the analytics row shows now: the latest snapshot, or a failed scrape's counters and draft. */
const currentMetrics = async (row: PostingRow): Promise<Metrics> => {
  if (isFailed(row)) {
    const failure = row.metricsScrapeFailure as ScrapeFailure | null;
    return { ...toMetrics(failure?.partial as Record<string, unknown> | null), ...failure?.entered };
  }
  return toMetrics((await latestSnapshot(row)) as Record<string, unknown> | null);
};

const writeScreenshotSnapshot = async (row: PostingRow, metrics: Metrics, actorId: string, insightId: string) => {
  const latest = await latestSnapshot(row);
  const now = new Date();
  const merged: PostMetrics = {
    views: latest?.views ?? 0,
    likes: latest?.likes ?? 0,
    comments: latest?.comments ?? 0,
    shares: latest?.shares ?? 0,
    saved: latest?.saved ?? 0,
    ...metrics,
  };
  const snapshotDate = scrapeDay(now);
  const postDate = scrapeDay(latest?.postDate ?? row.postingDate ?? now);
  const values = {
    daysSincePost: snapshotDate.diff(postDate, 'day'),
    capturedAt: now,
    ...merged,
    reach: latest?.reach || merged.views,
    engagementRate: scrapedEngagementRate(merged),
    rawMetrics: { screenshot: { insightId, by: actorId, applied: metrics } } as Prisma.InputJsonValue,
    source: 'screenshot',
  };

  await prisma.dailyPostEngagementSnapshot.upsert({
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
};

/** Applies the numbers. Throws when they cannot be applied, so nothing reports a change that did not happen. */
const applyMetrics = async (row: PostingRow, metrics: Metrics, actorId: string, insightId: string) => {
  if (!Object.keys(metrics).length) return;
  if (!isFailed(row)) {
    await writeScreenshotSnapshot(row, metrics, actorId, insightId);
    return;
  }

  // A failed scrape takes them as its draft and completes once every missing number is in.
  const result = await completeFailedScrape(prisma as unknown as PostScrapeStore, {
    campaignId: row.campaignId,
    postingUrlId: row.id,
    metrics,
    adminId: actorId,
  });
  if (result.ok) return;

  // A scrape finished in between, so the post is no longer failed: the numbers go on today's snapshot.
  const fresh =
    result.status === 409
      ? await prisma.submissionPostingUrl.findUnique({ where: { id: row.id }, include: WITH_CREATOR })
      : null;
  if (!fresh || isFailed(fresh)) throw new Error(`Could not apply the screenshot numbers: ${result.message}`);
  await writeScreenshotSnapshot(fresh, metrics, actorId, insightId);
};

/** Who added the newest screenshot. A lower number is shown as theirs, also after another screenshot is removed. */
const newestUploader = (screenshots: unknown, fallback: Actor): Actor => {
  const list = Array.isArray(screenshots) ? (screenshots as { uploadedBy?: Actor }[]) : [];
  return [...list].reverse().find((screenshot) => screenshot.uploadedBy)?.uploadedBy ?? fallback;
};

const saveReview = (id: string, review: MetricsReview) =>
  prisma.insightOcrResult.update({
    where: { id },
    data: { metricsReview: review as unknown as Prisma.InputJsonValue },
    select: { metricsReview: true },
  });

/**
 * After screenshots are added or removed: applies the numbers that are the same or higher,
 * and keeps the lower ones for an admin. Returns the new review state.
 */
export const syncScreenshotMetrics = async ({
  insightId,
  campaignId,
  submissionId,
  postUrl,
  actor,
}: {
  insightId: string;
  campaignId: string;
  submissionId: string;
  postUrl: string;
  actor: Actor;
}): Promise<MetricsReview | null> => {
  const record = await prisma.insightOcrResult.findUnique({
    where: { id: insightId },
    select: { values: true, metricsReview: true, screenshots: true },
  });
  const row = await findPostingRow(campaignId, submissionId, postUrl);
  if (!record || !row) return (record?.metricsReview as MetricsReview | null) ?? null;

  const review = (record.metricsReview as MetricsReview | null) ?? {};
  const screenshot = screenshotMetrics(record.values as Record<string, unknown>);
  const current = await currentMetrics(row);
  const { apply, lower } = splitMetrics(screenshot, current, review.dismissed);

  await applyMetrics(row, apply, actor.id, insightId);

  const lowerKeys = Object.keys(lower) as MetricKey[];
  const pending = lowerKeys.length
    ? {
        values: lower,
        current: Object.fromEntries(lowerKeys.map((key) => [key, current[key]])) as Metrics,
        uploadedBy: newestUploader(record.screenshots, actor),
        at: new Date().toISOString(),
      }
    : null;

  const saved = await saveReview(insightId, { ...review, pending });
  return saved.metricsReview as MetricsReview | null;
};

export type ReviewResult =
  | { ok: true; review: MetricsReview | null }
  | { ok: false; reason: 'nothing-pending' | 'post-not-found' };

/** An admin decides on lower screenshot numbers: use them, or keep the current ones. */
export const resolveMetricsReview = async ({
  insightId,
  actorId,
  approve,
}: {
  insightId: string;
  actorId: string;
  approve: boolean;
}): Promise<ReviewResult> => {
  const record = await prisma.insightOcrResult.findUnique({
    where: { id: insightId },
    select: { campaignId: true, submissionId: true, postUrl: true, metricsReview: true },
  });
  const review = (record?.metricsReview as MetricsReview | null) ?? {};
  if (!record?.campaignId || !record.submissionId || !record.postUrl || !review.pending) {
    return { ok: false, reason: 'nothing-pending' };
  }

  if (approve) {
    // The pending numbers stay when they cannot be applied, so the admin can try again.
    const row = await findPostingRow(record.campaignId, record.submissionId, record.postUrl);
    if (!row) return { ok: false, reason: 'post-not-found' };
    await applyMetrics(row, review.pending.values, actorId, insightId);
  }

  const dismissed = approve ? review.dismissed : { ...review.dismissed, ...review.pending.values };
  const saved = await saveReview(insightId, { dismissed, pending: null });
  return { ok: true, review: saved.metricsReview as MetricsReview | null };
};

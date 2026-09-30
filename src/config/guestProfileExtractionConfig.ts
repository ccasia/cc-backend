import type { SupportedPlatform } from '@/src/types/guestProfileExtraction';

/**
 * Backend-only configuration for guest profile extraction.
 *
 * The browser never sees a dataset ID, a contract version, or a token. Every
 * value is read here and nowhere else.
 */

/** One Bright Data Web Scraper API dataset, and how it is triggered. */
export interface ScraperJob {
  datasetId: string;
  /** `discover_by` for a discovery job. Null for a plain collect-by-URL job. */
  discoverBy: string | null;
}

export interface PlatformScrapers {
  posts: ScraperJob;
  profile: ScraperJob;
  /**
   * The field contract the adapter was certified against.
   *
   * Bright Data has no version pinning: a collector can change without notice.
   * This value replaces the previous provider's pinned build. It is stored in `actorBuild`,
   * keys the cache and the work fingerprint, and is bumped by hand whenever an
   * adapter's field contract changes. `actorBuild` is VarChar(40).
   */
  contractVersion: string;
  /**
   * Whether the posts job honours `posts_to_not_include`, so a second batch
   * can ask for the next posts only. Instagram Reels: certified 2026-09-30
   * (20 asked, 20 new, none repeated). TikTok: not certified, so its second
   * batch asks for the full total and the repeats are dropped.
   */
  topUpExcludes: boolean;
}

export interface ExtractionConfig {
  token: string;
  scrapers: Record<SupportedPlatform, PlatformScrapers>;
  /** How long the worker polls one job before it cancels it. */
  pollTimeoutSeconds: number;
  /** `num_of_posts` per profile on the posts job. */
  maxPostsPerProfile: number;
  /**
   * The most posts one extraction may fetch across both batches. When the
   * first batch leaves too few usable posts, a second batch runs, up to this
   * total. Equal to `maxPostsPerProfile` turns the second batch off.
   */
  maxTotalPostsPerProfile: number;
  /**
   * How many extractions run at once.
   *
   * Not a spending limit. Bright Data allows 5,000 concurrent jobs, so this
   * only bounds how many worker slots sit polling. Each extraction holds a
   * slot for up to `pollTimeoutSeconds`.
   */
  workerConcurrency: number;
  /** `Infinity` means no limit. */
  maxActiveExtractionsPerAdmin: number;
  /** `Infinity` means no limit. */
  maxProfilesPerBatch: number;
  /** How long a completed result may be reused. `0` always fetches fresh. */
  cacheTtlMs: number;
  /** How long a completed extraction row is kept before cleanup. */
  retentionMs: number;
  receiptTtlMs: number;
  featureEnabled: boolean;
}

export const BRIGHTDATA_API_BASE_URL = 'https://api.brightdata.com';

/**
 * Dataset IDs are code, not env: each adapter is bound to one dataset's
 * output schema, so pointing an env var at another dataset would only fail
 * closed as PROVIDER_SCHEMA_CHANGED.
 *
 * Instagram posts come from the Reels discovery, not the Posts dataset. The
 * rate divides by views and only a video carries one. Measured on the previous provider with
 * claude0417 on 2026-09-07: a posts listing returned 39 items, 5 of them
 * video and 3 usable. The profile's own `posts[]` grid is twelve items with
 * no views, so it cannot supply the sample either; it only supplies the
 * pinned flag and a fallback date.
 *
 * TikTok posts use the "Posts by Profile Fast API". The profile dataset
 * supplies followers and the private flag, which no posts item carries.
 */
export const SCRAPERS: Record<SupportedPlatform, PlatformScrapers> = {
  instagram: {
    posts: { datasetId: 'gd_lyclm20il4r5helnj', discoverBy: 'url_all_reels' },
    profile: { datasetId: 'gd_l1vikfch901nx3by4', discoverBy: null },
    contractVersion: 'brightdata-ig-2026-09',
    topUpExcludes: true,
  },
  tiktok: {
    posts: { datasetId: 'gd_m7n5v2gq296pex2f5m', discoverBy: null },
    profile: { datasetId: 'gd_l1villgoiiidt09ci', discoverBy: null },
    contractVersion: 'brightdata-tt-2026-09',
    topUpExcludes: false,
  },
};

const int = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

/** Like `int`, but 0 is a real answer rather than "use the default". */
const intAllowingZero = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
};

/** A blank value means no limit. */
const limit = (value: string | undefined): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : Number.POSITIVE_INFINITY;
};

/**
 * Batch size, read on its own.
 *
 * The guest create path also serves the manual mode, which needs no Bright
 * Data setup, so this must not go through `loadExtractionConfig` and its token
 * check.
 */
export function maxProfilesPerBatch(env: NodeJS.ProcessEnv = process.env): number {
  return limit(env.ENGAGEMENT_MAX_PROFILES_PER_BATCH);
}

export function loadExtractionConfig(env: NodeJS.ProcessEnv = process.env): ExtractionConfig {
  const token = (env.BRIGHTDATA_API_TOKEN ?? '').trim();
  if (!token) throw new Error('BRIGHTDATA_API_TOKEN is not set.');

  return {
    token,
    scrapers: SCRAPERS,
    // Discovery jobs take 1-7 minutes. Bright Data's own Python SDK waits 420
    // seconds for a Reels discovery.
    pollTimeoutSeconds: int(env.BRIGHTDATA_POLL_TIMEOUT_SECONDS, 420),
    // Ten valid posts need headroom for pinned, paid-partnership, collab and
    // hidden-likes items that the policy drops.
    maxPostsPerProfile: int(env.BRIGHTDATA_MAX_POSTS_PER_PROFILE, 20),
    // A second batch of 20 only when the first is short: 40 at most (PM, 2026-09-30).
    maxTotalPostsPerProfile: int(env.BRIGHTDATA_MAX_TOTAL_POSTS_PER_PROFILE, 40),
    workerConcurrency: int(env.ENGAGEMENT_WORKER_CONCURRENCY, 4),
    maxActiveExtractionsPerAdmin: limit(env.ENGAGEMENT_MAX_ACTIVE_PER_ADMIN),
    maxProfilesPerBatch: limit(env.ENGAGEMENT_MAX_PROFILES_PER_BATCH),
    // Off by default. Every fetch is fresh unless a window is configured.
    cacheTtlMs: intAllowingZero(env.ENGAGEMENT_CACHE_TTL_MINUTES, 0) * 60_000,
    retentionMs: int(env.ENGAGEMENT_RETENTION_DAYS, 30) * 86_400_000,
    receiptTtlMs: int(env.ENGAGEMENT_RECEIPT_TTL_MINUTES, 30) * 60_000,
    featureEnabled: (env.GUEST_PROFILE_METRICS_ENABLED ?? 'false').toLowerCase() === 'true',
  };
}

/** Which job an input is for. Both platforms run a posts job and a profile job. */
export type ScraperJobPurpose = 'posts' | 'profile';

/**
 * The trigger input for one profile. One element: one profile per job.
 *
 * Never send `start_date` / `end_date` to the Instagram Reels discovery.
 * Bright Data removed both in August 2026 and now answers `bad_input`.
 */
export function buildJobInput(
  platform: SupportedPlatform,
  canonicalProfileUrl: string,
  config: ExtractionConfig,
  purpose: ScraperJobPurpose,
): Record<string, unknown>[] {
  if (purpose === 'profile') return [{ url: canonicalProfileUrl }];
  return [{ url: canonicalProfileUrl, num_of_posts: config.maxPostsPerProfile }];
}

/** Posts the second batch may add, so both batches stay within the total. */
export function topUpBatchSize(config: ExtractionConfig): number {
  return Math.max(0, config.maxTotalPostsPerProfile - config.maxPostsPerProfile);
}

/**
 * The trigger input for the second posts batch.
 *
 * Where the job honours `posts_to_not_include`, it asks for the next posts
 * only and passes the first batch's IDs. Otherwise it asks for the full total
 * and the caller drops the repeats.
 */
export function buildTopUpInput(
  platform: SupportedPlatform,
  canonicalProfileUrl: string,
  config: ExtractionConfig,
  seenPostIds: string[],
): Record<string, unknown>[] {
  if (config.scrapers[platform].topUpExcludes) {
    return [{ url: canonicalProfileUrl, num_of_posts: topUpBatchSize(config), posts_to_not_include: seenPostIds }];
  }
  return [{ url: canonicalProfileUrl, num_of_posts: config.maxTotalPostsPerProfile }];
}

import type { SupportedPlatform } from '@/src/types/guestProfileExtraction';

/**
 * Backend-only configuration for guest profile extraction.
 *
 * The browser never sees an actor ID, a build, a token, or a cost cap. Every
 * value is read here and nowhere else.
 */

export interface ActorConfig {
  actorId: string;
  /** Exact pinned build, for example `0.0.776`. Never `latest`. */
  build: string;
}

export interface ExtractionConfig {
  token: string;
  actors: Record<SupportedPlatform, ActorConfig>;
  runTimeoutSeconds: number;
  maxDatasetItems: number;
  /** Measured cap. A run above it fails with COST_LIMIT. */
  maxCostUsdPerRun: number | null;
  /**
   * How many paid runs may be in flight at once.
   *
   * This is not a spending limit. It is the Apify account's memory cap:
   * Instagram reserves 1024MB per run and TikTok 4096MB. Going past the plan
   * makes runs queue at Apify or fail.
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

const float = (value: string | undefined): number | null => {
  const parsed = Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

function requireBuild(platform: SupportedPlatform, value: string | undefined): string {
  const build = (value ?? '').trim();
  if (!build) {
    throw new Error(`APIFY_${platform.toUpperCase()}_ACTOR_BUILD is not set. Pin the exact tested build.`);
  }
  if (build === 'latest') {
    throw new Error(
      `APIFY_${platform.toUpperCase()}_ACTOR_BUILD is "latest". Pin an exact build number so a provider release cannot change results.`,
    );
  }
  return build;
}

/**
 * Batch size, read on its own.
 *
 * The guest create path also serves the manual mode, which needs no Apify
 * setup, so this must not go through `loadExtractionConfig` and its token
 * check.
 */
export function maxProfilesPerBatch(env: NodeJS.ProcessEnv = process.env): number {
  return limit(env.ENGAGEMENT_MAX_PROFILES_PER_BATCH);
}

export function loadExtractionConfig(env: NodeJS.ProcessEnv = process.env): ExtractionConfig {
  const token = (env.APIFY_TOKEN ?? '').trim();
  if (!token) throw new Error('APIFY_TOKEN is not set.');

  return {
    token,
    actors: {
      instagram: {
        actorId: (env.APIFY_INSTAGRAM_ACTOR_ID ?? 'apify/instagram-scraper').trim(),
        build: requireBuild('instagram', env.APIFY_INSTAGRAM_ACTOR_BUILD),
      },
      tiktok: {
        actorId: (env.APIFY_TIKTOK_ACTOR_ID ?? 'clockworks/tiktok-profile-scraper').trim(),
        build: requireBuild('tiktok', env.APIFY_TIKTOK_ACTOR_BUILD),
      },
    },
    runTimeoutSeconds: int(env.APIFY_RUN_TIMEOUT_SECONDS, 90),
    // Ten valid posts need headroom for pinned, sponsored, repost, duplicate
    // and (on Instagram) photo candidates that the policy drops.
    maxDatasetItems: int(env.APIFY_MAX_DATASET_ITEMS, 40),
    maxCostUsdPerRun: float(env.APIFY_MAX_COST_USD_PER_RUN),
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

/**
 * Which run an actor input is for.
 *
 * Instagram needs two. `apify/instagram-scraper` caps `details` mode at twelve
 * posts whatever `resultsLimit` says (measured on build 0.0.776), and reports
 * no follower count in any feed mode, even with `addParentData`. So the
 * follower count comes from `details` and the metrics from a feed run.
 *
 * The feed run is `reels`, not `posts`. The rate divides by views, and only a
 * video carries one, so every carousel a `posts` run returns is a wasted slot.
 * Measured on claude0417 2026-09-07: `posts` returned 39 items of which 5 were
 * video and 3 were usable, which failed the ten-post rule; `reels` returned 40
 * usable videos and produced a rate. `reels` also reports `isPinned`, which
 * `posts` mode omits entirely.
 *
 * TikTok needs one. `clockworks/tiktok-profile-scraper` has no modes, and
 * every item carries the author snapshot alongside the post metrics.
 */
export type ActorRunPurpose = 'posts' | 'profile';

/** The actor input for one profile. Media and comments stay off. */
export function buildActorInput(
  platform: SupportedPlatform,
  canonicalProfileUrl: string,
  config: ExtractionConfig,
  purpose: ActorRunPurpose = 'posts',
): Record<string, unknown> {
  if (platform === 'instagram') {
    return purpose === 'profile'
      ? {
          directUrls: [canonicalProfileUrl],
          resultsType: 'details',
          // One profile item. Its posts are ignored; the posts run supplies them.
          resultsLimit: 1,
          addParentData: false,
          searchType: 'user',
        }
      : {
          directUrls: [canonicalProfileUrl],
          // Reels only. See the note above: a carousel has no view count, so a
          // `posts` run spends most of its budget on posts the policy drops.
          resultsType: 'reels',
          resultsLimit: config.maxDatasetItems,
          addParentData: false,
          searchType: 'user',
        };
  }
  /**
   * One run supplies everything.
   *
   * Every item carries both the post metrics and an `authorMeta` block with
   * the handle and follower count, so TikTok needs no second profile run the
   * way Instagram does.
   */
  return {
    profiles: [canonicalProfileUrl],
    profileScrapeSections: ['videos'],
    // Newest first, measured 2026-09-08. This is what lets the item cap cut the
    // tail rather than the middle, which is the bug Instagram's `posts` mode
    // has.
    profileSorting: 'latest',
    resultsPerPage: config.maxDatasetItems,
    // The actor drops pinned posts itself. The policy still checks `isPinned`,
    // so a build that stops honouring this cannot quietly let one through.
    excludePinnedPosts: true,
  };
}

/** True when this platform needs a second run for the follower count. */
export function needsProfileRun(platform: SupportedPlatform): boolean {
  return platform === 'instagram';
}

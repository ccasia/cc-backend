import crypto from 'crypto';

import {
  buildJobInput,
  buildTopUpInput,
  topUpBatchSize,
  type ExtractionConfig,
} from '@configs/guestProfileExtractionConfig';
import type {
  AdapterResult,
  CanonicalProfile,
  MetricBaseline,
  SupportedPlatform,
} from '@/src/types/guestProfileExtraction';
import { RateLimitedError, type JobSnapshot, type ScraperGateway } from './brightDataGateway';
import { computeEngagementRate, formatEngagementRatePercent } from './engagementRateCalculator';
import { createReceiptNonce, digestResult } from './extractionReceiptService';
import { normalizeProfileUrl } from './profileUrlNormalizer';
import { parseInstagramOutput } from './scraperAdapters/instagramAdapter';
import { parseTiktokOutput } from './scraperAdapters/tiktokAdapter';
import { applyValidPostPolicy, markSampleInCandidates, selectSample } from './validPostPolicy';

/**
 * Orchestration for one durable unit of provider work.
 *
 * The order is fixed and the tests hold it in place:
 *  1. Persist the extraction row.
 *  2. Enqueue the job.
 *  3. Persist the Bright Data snapshot ID (posts job, then profile job).
 *  4. Poll, until `pollTimeoutSeconds`; a job past the deadline is canceled.
 *
 * An ambiguous start becomes REQUIRES_RECONCILIATION. It never starts a second
 * paid job. A 429 is a definite failure and is never retried automatically.
 */

/** Only the delegates this service uses, so a test can supply a small fake. */
export interface ExtractionStore {
  guestProfileExtraction: {
    create(args: { data: any }): Promise<any>;
    findUnique(args: { where: any }): Promise<any | null>;
    findFirst(args: { where: any; orderBy?: any }): Promise<any | null>;
    findMany(args: { where: any; orderBy?: any; take?: number }): Promise<any[]>;
    update(args: { where: any; data: any }): Promise<any>;
    count(args: { where: any }): Promise<number>;
    deleteMany(args: { where: any }): Promise<{ count: number }>;
  };
  guestProfileIdentityConflict: {
    findUnique(args: { where: any }): Promise<any | null>;
  };
}

export interface ExtractionDeps {
  store: ExtractionStore;
  gateway: ScraperGateway;
  config: ExtractionConfig;
  enqueue(extractionId: string): Promise<void>;
  now?(): Date;
  sleep?(ms: number): Promise<void>;
  log?(message: string, context?: Record<string, unknown>): void;
  /** Returns a durable copy of a provider thumbnail, or null when the copy fails. */
  cacheThumbnail?(sourceUrl: string, platform: string, postId: string): Promise<string | null>;
}

export const ACTIVE_STATUSES = ['QUEUED', 'RUNNING', 'POLLING'] as const;
export const TERMINAL_STATUSES = ['READY', 'INSUFFICIENT_DATA', 'FAILED', 'CANCELLED', 'STALE'] as const;

/** Discovery jobs take 1-7 minutes, so the delay grows to 15 seconds. */
const BASE_POLL_DELAY_MS = 2_000;
const MAX_POLL_DELAY_MS = 15_000;
/** A job the progress endpoint never knows is missing after this many reads. */
const MAX_NOT_FOUND_READS = 3;
const MAX_RECONCILE_ATTEMPTS = 5;
/**
 * Provider lookups per reconciliation pass, at most. Each lookup is up to 11
 * requests; the rest wait for the next pass, 5 minutes later.
 */
const MAX_RECONCILE_LOOKUPS_PER_PASS = 5;

const now = (deps: ExtractionDeps): Date => (deps.now ? deps.now() : new Date());
const sleep = (deps: ExtractionDeps, ms: number): Promise<void> =>
  deps.sleep ? deps.sleep(ms) : new Promise((resolve) => setTimeout(resolve, ms));
const log = (deps: ExtractionDeps, message: string, context?: Record<string, unknown>): void => {
  if (deps.log) deps.log(message, context);
};

/** Identity of the work, not of the request. Two admins share one fingerprint. */
export function workFingerprint(input: {
  canonicalProfileKey: string;
  platform: SupportedPlatform;
  datasetId: string;
  contractVersion: string;
  maxPostsPerProfile: number;
}): string {
  return crypto
    .createHash('sha256')
    .update(
      [
        input.canonicalProfileKey,
        input.platform,
        input.datasetId,
        input.contractVersion,
        input.maxPostsPerProfile,
      ].join('|'),
    )
    .digest('hex');
}

export type StartOutcome =
  | { status: 'queued'; extraction: any }
  | { status: 'active'; extraction: any }
  | { status: 'ready'; extraction: any; reusedRunId: string | null }
  | { status: 'conflict'; message: string }
  | { status: 'rejected'; code: string; message: string };

export interface StartExtractionInput {
  campaignId: string;
  requesterUserId: string;
  profileLink: string;
  expectedPlatform?: SupportedPlatform;
  idempotencyKey: string;
}

export async function startExtraction(input: StartExtractionInput, deps: ExtractionDeps): Promise<StartOutcome> {
  const { store, config } = deps;

  const normalized = normalizeProfileUrl(input.profileLink);
  if (!normalized.ok) {
    return { status: 'rejected', code: normalized.code, message: normalized.message };
  }
  const profile: CanonicalProfile = normalized.profile;

  // Registered-creator rows carry explicit admin intent. Reject a mismatch
  // before identity checks, cache lookup, persistence, or queueing.
  if (input.expectedPlatform && profile.platform !== input.expectedPlatform) {
    const label = input.expectedPlatform === 'tiktok' ? 'TikTok' : 'Instagram';
    return {
      status: 'rejected',
      code: 'PLATFORM_MISMATCH',
      message: `Use a ${label} profile link.`,
    };
  }

  const conflict = await store.guestProfileIdentityConflict.findUnique({
    where: { canonicalProfileKey: profile.canonicalKey },
  });
  if (conflict && conflict.status === 'UNRESOLVED') {
    return {
      status: 'rejected',
      code: 'GUEST_IDENTITY_CONFLICT',
      message: `${profile.canonicalKey} matches more than one existing guest creator. Resolve the conflict first.`,
    };
  }

  const scrapers = config.scrapers[profile.platform];
  const fingerprint = workFingerprint({
    canonicalProfileKey: profile.canonicalKey,
    platform: profile.platform,
    datasetId: scrapers.posts.datasetId,
    contractVersion: scrapers.contractVersion,
    maxPostsPerProfile: config.maxPostsPerProfile,
  });

  // Start idempotency. Same key and same work returns the saved record.
  const existing = await store.guestProfileExtraction.findFirst({
    where: { requestedByUserId: input.requesterUserId, idempotencyKey: input.idempotencyKey },
  });
  if (existing) {
    if (existing.requestFingerprint !== fingerprint) {
      return { status: 'conflict', message: 'This idempotency key was used for a different profile.' };
    }

    // The same key asking again is a duplicate start. Count it, so a browser
    // that asks twice is visible in the canary numbers.
    await store.guestProfileExtraction.update({
      where: { id: existing.id },
      data: { duplicateStartAttempts: (existing.duplicateStartAttempts ?? 0) + 1 },
    });

    return (ACTIVE_STATUSES as readonly string[]).includes(existing.status)
      ? { status: 'active', extraction: existing }
      : { status: 'ready', extraction: existing, reusedRunId: existing.actorRunId ?? null };
  }

  if (Number.isFinite(config.maxActiveExtractionsPerAdmin)) {
    const active = await store.guestProfileExtraction.count({
      where: { requestedByUserId: input.requesterUserId, status: { in: [...ACTIVE_STATUSES] } },
    });
    if (active >= config.maxActiveExtractionsPerAdmin) {
      return {
        status: 'rejected',
        code: 'TOO_MANY_ACTIVE',
        message: `Wait for your ${config.maxActiveExtractionsPerAdmin} running fetches to finish.`,
      };
    }
  }

  const at = now(deps);

  // Cache reuse. A completed result for the same work, on the same adapter
  // contract, inside the window, saves a paid job. A row from the previous provider carries a
  // different `actorBuild` and is never reused.
  const cached =
    config.cacheTtlMs > 0
      ? await store.guestProfileExtraction.findFirst({
          where: {
            canonicalProfileKey: profile.canonicalKey,
            platform: profile.platform,
            actorBuild: scrapers.contractVersion,
            status: 'READY',
            completedAt: { gte: new Date(at.getTime() - config.cacheTtlMs) },
          },
          orderBy: { completedAt: 'desc' },
        })
      : null;

  const base = {
    campaignId: input.campaignId,
    requestedByUserId: input.requesterUserId,
    canonicalProfileKey: profile.canonicalKey,
    canonicalProfileUrl: profile.canonicalUrl,
    platform: profile.platform,
    // Column names predate Bright Data: `actorId` holds the posts dataset ID
    // and `actorBuild` the adapter contract version.
    actorId: scrapers.posts.datasetId,
    actorBuild: scrapers.contractVersion,
    idempotencyKey: input.idempotencyKey,
    requestFingerprint: fingerprint,
    unverifiedFlags: [] as string[],
    createdAt: at,
    updatedAt: at,
  };

  if (cached) {
    // A reused result still gets its own nonce, so the receipt stays bound to
    // this admin and can only be spent once.
    const extraction = await store.guestProfileExtraction.create({
      data: {
        ...base,
        status: 'READY',
        actorRunId: cached.actorRunId,
        actorDatasetId: cached.actorDatasetId,
        resultName: cached.resultName,
        resultBiography: cached.resultBiography,
        profileActorRunId: cached.profileActorRunId,
        profileActorDatasetId: cached.profileActorDatasetId,
        candidatePosts: cached.candidatePosts,
        resultFollowerCount: cached.resultFollowerCount,
        resultEngagementRate: cached.resultEngagementRate,
        sampleSize: cached.sampleSize,
        formulaVersion: cached.formulaVersion,
        selectedPosts: cached.selectedPosts,
        unverifiedFlags: cached.unverifiedFlags ?? [],
        startedAt: at,
        completedAt: at,
        expiresAt: new Date(at.getTime() + config.retentionMs),
        // No paid job happened here. The cost stays on the row that paid.
        reusedFromExtractionId: cached.id,
        ...receiptFields(
          deps,
          {
            name: cached.resultName,
            followerCount: cached.resultFollowerCount,
            engagementRate: cached.resultEngagementRate,
          },
          cached.sampleSize ?? 0,
          postIdsOf(cached.selectedPosts),
          at,
        ),
      },
    });
    log(deps, 'extraction cache hit', { canonicalProfileKey: profile.canonicalKey });
    return { status: 'ready', extraction, reusedRunId: cached.actorRunId ?? null };
  }

  // Persist first, enqueue second. A crash between the two is recoverable.
  const extraction = await store.guestProfileExtraction.create({
    data: { ...base, status: 'QUEUED', expiresAt: new Date(at.getTime() + config.retentionMs) },
  });
  await deps.enqueue(extraction.id);

  return { status: 'queued', extraction };
}

function postIdsOf(selectedPosts: unknown): string[] {
  if (!Array.isArray(selectedPosts)) return [];
  return selectedPosts
    .map((post) => (post && typeof post === 'object' ? (post as { postId?: unknown }).postId : null))
    .filter((id): id is string => typeof id === 'string');
}

function receiptFields(
  deps: ExtractionDeps,
  baseline: MetricBaseline,
  sampleSize: number,
  postIds: string[],
  at: Date,
): Record<string, unknown> {
  return {
    receiptNonce: createReceiptNonce(),
    receiptDigest: digestResult({ baseline, sampleSize, postIds }),
    receiptExpiresAt: new Date(at.getTime() + deps.config.receiptTtlMs),
  };
}

/* ------------------------------------------------------------- Worker body */

const pollDelay = (attempt: number): number => Math.min(BASE_POLL_DELAY_MS * 2 ** attempt, MAX_POLL_DELAY_MS);

/** Bright Data `error_message` values that mean the profile had nothing to collect. */
const NO_DATA = /no data found in discovery|snapshot is empty/i;

type PollOutcome =
  | { kind: 'done'; snapshot: JobSnapshot }
  | { kind: 'not_found' }
  | { kind: 'timeout'; snapshot: JobSnapshot };

/**
 * Poll one job until it leaves RUNNING, or until `pollTimeoutSeconds` of
 * waiting has passed.
 *
 * The deadline counts time slept, not the wall clock, so a test with a fake
 * `sleep` finishes and a slow network call cannot shorten the window. A job
 * the progress endpoint does not know yet is read a few times before it is
 * called missing: a just-triggered job can lag behind.
 */
async function pollJob(deps: ExtractionDeps, jobId: string): Promise<PollOutcome> {
  const budgetMs = deps.config.pollTimeoutSeconds * 1000;
  let waitedMs = 0;
  let misses = 0;
  let last: JobSnapshot | null = null;

  for (let attempt = 0; ; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const snapshot = await deps.gateway.getJob(jobId);
    if (snapshot) {
      last = snapshot;
      if (snapshot.state !== 'RUNNING') return { kind: 'done', snapshot };
    } else {
      misses += 1;
      if (misses >= MAX_NOT_FOUND_READS) return { kind: 'not_found' };
    }

    if (waitedMs >= budgetMs) {
      return last ? { kind: 'timeout', snapshot: last } : { kind: 'not_found' };
    }
    const delay = pollDelay(attempt);
    waitedMs += delay;
    // eslint-disable-next-line no-await-in-loop
    await sleep(deps, delay);
  }
}

async function markFailed(deps: ExtractionDeps, id: string, code: string, message: string): Promise<void> {
  const at = now(deps);
  await deps.store.guestProfileExtraction.update({
    where: { id },
    data: { status: 'FAILED', failureCode: code, failureMessage: message, completedAt: at, updatedAt: at },
  });
  log(deps, 'extraction failed', { id, code });
}

function runAdapter(
  platform: SupportedPlatform,
  items: unknown[],
  expectedUsername: string,
  profileItems: unknown[] | null,
): AdapterResult {
  return platform === 'instagram'
    ? parseInstagramOutput({ items, profileItems, expectedUsername })
    : parseTiktokOutput({ items, profileItems, expectedUsername });
}

/**
 * Read the profile job, where one was started.
 *
 * Best effort by design. The follower count is not part of the v2 formula, so
 * a profile job that fails must not cost the admin the whole rate. The job ID
 * was persisted at start, so the charge is traceable either way. A job still
 * running at the deadline is canceled, which stops billing.
 */
async function readProfileJob(
  deps: ExtractionDeps,
  record: { profileActorRunId?: string | null },
): Promise<unknown[] | null> {
  const jobId = record.profileActorRunId;
  if (!jobId) return null;

  try {
    const outcome = await pollJob(deps, jobId);
    if (outcome.kind === 'timeout') await deps.gateway.cancelJob(jobId);
    if (outcome.kind !== 'done' || outcome.snapshot.state !== 'SUCCEEDED') {
      log(deps, 'profile job gave no profile', {
        jobId,
        state: outcome.kind === 'not_found' ? 'unreadable' : outcome.snapshot.state,
      });
      return null;
    }
    return await deps.gateway.listItems(jobId);
  } catch (error) {
    log(deps, 'profile job could not be read', { jobId, message: (error as Error)?.message });
    return null;
  }
}

/**
 * Run one extraction to a terminal state.
 *
 * Safe to call again. A record that already finished is left alone, and a
 * record that already has a job ID resumes polling instead of starting again.
 */
export async function processExtraction(extractionId: string, deps: ExtractionDeps): Promise<void> {
  const { store, config } = deps;
  const record = await store.guestProfileExtraction.findUnique({ where: { id: extractionId } });
  if (!record) return;
  if ((TERMINAL_STATUSES as readonly string[]).includes(record.status)) return;
  if (record.status === 'REQUIRES_RECONCILIATION') return;

  const platform = record.platform as SupportedPlatform;
  const scrapers = config.scrapers[platform];
  let runId: string | null = record.actorRunId ?? null;

  if (!runId) {
    const started = await deps.gateway.startJob({
      datasetId: scrapers.posts.datasetId,
      discoverBy: scrapers.posts.discoverBy,
      input: buildJobInput(platform, record.canonicalProfileUrl, config, 'posts'),
    });

    if (!started.ok && started.ambiguous) {
      // The call may have started a paid job. Reconciliation looks for it.
      await store.guestProfileExtraction.update({
        where: { id: extractionId },
        data: { status: 'REQUIRES_RECONCILIATION', failureMessage: started.message, updatedAt: now(deps) },
      });
      log(deps, 'extraction start was ambiguous', { id: extractionId });
      return;
    }
    if (!started.ok) {
      await markFailed(deps, extractionId, started.code, started.message);
      return;
    }

    // Persist the job ID before any polling, so a restart can resume it.
    // Provenance is rewritten too: a row queued under an older provider or
    // contract is scraped by this one, and audits copy these two columns.
    runId = started.runId;
    await store.guestProfileExtraction.update({
      where: { id: extractionId },
      data: {
        actorRunId: runId,
        actorId: scrapers.posts.datasetId,
        actorBuild: scrapers.contractVersion,
        status: 'RUNNING',
        startedAt: now(deps),
        updatedAt: now(deps),
      },
    });
  }

  // Both platforms, and only once. The profile job supplies followers and the
  // private flag, and the rate does not depend on it, so nothing in here may
  // fail the extraction. The catch covers the store as well as the provider:
  // a worker running an older Prisma Client would otherwise throw on the
  // column and lose a job that had already been paid for.
  if (!record.profileActorRunId) {
    try {
      const profileJob = await deps.gateway.startJob({
        datasetId: scrapers.profile.datasetId,
        discoverBy: scrapers.profile.discoverBy,
        input: buildJobInput(platform, record.canonicalProfileUrl, config, 'profile'),
      });

      if (!profileJob.ok) {
        log(deps, 'profile job did not start', { id: extractionId, message: profileJob.message });
      } else {
        await store.guestProfileExtraction.update({
          where: { id: extractionId },
          data: { profileActorRunId: profileJob.runId, updatedAt: now(deps) },
        });
        record.profileActorRunId = profileJob.runId;
      }
    } catch (error) {
      log(deps, 'profile job could not be recorded', {
        id: extractionId,
        message: (error as Error)?.message,
      });
    }
  }

  await store.guestProfileExtraction.update({
    where: { id: extractionId },
    data: { status: 'POLLING', updatedAt: now(deps) },
  });

  const outcome = await pollJob(deps, runId);

  if (outcome.kind === 'not_found') {
    await markFailed(deps, extractionId, 'RUN_NOT_FOUND', `Job ${runId} could not be read.`);
    return;
  }
  if (outcome.kind === 'timeout') {
    // Cancel both: a canceled job stops billing and delivers nothing.
    await deps.gateway.cancelJob(runId);
    if (record.profileActorRunId) await deps.gateway.cancelJob(record.profileActorRunId);
    await markFailed(
      deps,
      extractionId,
      'POLL_TIMEOUT',
      `The job did not finish inside ${config.pollTimeoutSeconds} seconds and was canceled.`,
    );
    return;
  }

  const { snapshot } = outcome;
  const noData = snapshot.state === 'FAILED' && NO_DATA.test(snapshot.errorMessage ?? '');
  if (snapshot.state !== 'SUCCEEDED' && !noData) {
    await markFailed(
      deps,
      extractionId,
      snapshot.state,
      snapshot.errorMessage ?? `The provider job ended ${snapshot.state}.`,
    );
    return;
  }

  // "No data found" is a failed job with nothing to download. The profile job
  // tells a private account, a public account with no posts
  // (INSUFFICIENT_DATA), and a missing account apart; the adapter decides
  // from empty items plus the profile.
  const items = noData ? [] : await deps.gateway.listItems(runId);
  const profileItems = await readProfileJob(deps, record);
  const username = record.canonicalProfileKey.split(':')[1] ?? '';
  const parsed = runAdapter(platform, items, username, profileItems);

  const at = now(deps);
  const common = {
    // A Bright Data snapshot is both the job and its data.
    actorDatasetId: runId,
    profileActorDatasetId: record.profileActorRunId ?? null,
    // Bright Data reports no per-job cost. Spend is checked in its dashboard.
    costUsd: null,
    profileCostUsd: null,
    completedAt: at,
    updatedAt: at,
  };

  if (!parsed.ok) {
    await store.guestProfileExtraction.update({
      where: { id: extractionId },
      data: { ...common, status: 'FAILED', failureCode: parsed.code, failureMessage: parsed.message },
    });
    return;
  }

  let policy = applyValidPostPolicy(parsed.candidates, { ownerHandle: username, now: at });
  let sample = selectSample(policy.valid);

  // Too few usable posts in the first batch: fetch one more batch, then judge
  // both together. Never more than two batches (PM, 2026-09-30). If the second
  // batch cannot be read, the first batch's result stands.
  if (!sample.ok) {
    const extraItems = await fetchSecondBatch(deps, extractionId, record, items);
    if (extraItems.length > 0) {
      const merged = runAdapter(platform, [...items, ...extraItems], username, profileItems);
      if (merged.ok) {
        policy = applyValidPostPolicy(uniqueByPostId(merged.candidates), { ownerHandle: username, now: at });
        sample = selectSample(policy.valid);
      }
    }
  }

  if (!sample.ok) {
    await store.guestProfileExtraction.update({
      where: { id: extractionId },
      data: {
        ...common,
        status: 'INSUFFICIENT_DATA',
        // The profile was read even though the posts were not enough. The
        // admin still gets the name and follower count, and types the rate.
        resultName: parsed.profile.displayName ?? parsed.profile.username,
        resultFollowerCount: parsed.profile.followerCount,
        sampleSize: sample.validCount,
        unverifiedFlags: policy.unverifiedFlags,
        // Kept on purpose. This is the evidence for why ten were not found.
        candidatePosts: policy.evaluated,
        failureCode: 'INSUFFICIENT_DATA',
        // The per-post reasons are in candidatePosts[].rejectedReason.
        failureMessage:
          record.platform === 'instagram'
            ? `Only ${sample.validCount} of the ${sample.required} usable Reels needed were found. A Reel is left out when its likes are hidden, or when it is a paid partnership, pinned, or a collab with another account.`
            : `Only ${sample.validCount} of the ${sample.required} usable videos needed were found. A video is left out when its likes are hidden, or when it is an ad, pinned, or a repost.`,
      },
    });
    return;
  }

  const rate = computeEngagementRate({
    platform: record.platform,
    posts: sample.posts,
    followerCount: parsed.profile.followerCount,
  });
  if (!rate.ok) {
    await store.guestProfileExtraction.update({
      where: { id: extractionId },
      data: { ...common, status: 'FAILED', failureCode: rate.code, failureMessage: rate.message },
    });
    return;
  }

  const baseline: MetricBaseline = {
    name: parsed.profile.displayName ?? parsed.profile.username,
    followerCount: rate.followerCount,
    engagementRate: formatEngagementRatePercent(rate.engagementRatePercent),
  };

  await store.guestProfileExtraction.update({
    where: { id: extractionId },
    data: {
      ...common,
      status: 'READY',
      resultName: baseline.name,
      resultBiography: parsed.profile.biography ?? null,
      resultFollowerCount: baseline.followerCount,
      resultEngagementRate: baseline.engagementRate,
      sampleSize: rate.sampleSize,
      formulaVersion: rate.formulaId,
      selectedPosts: await cacheSelectedThumbnails(deps, record.platform, rate.evidence),
      candidatePosts: markSampleInCandidates(policy.evaluated, sample.posts),
      unverifiedFlags: policy.unverifiedFlags,
      ...receiptFields(
        deps,
        baseline,
        rate.sampleSize,
        rate.evidence.map((e) => e.postId),
        at,
      ),
    },
  });
  log(deps, 'extraction ready', {
    id: extractionId,
    formulaVersion: rate.formulaId,
    savesReported: rate.savesReported,
  });
}

/** Raw provider post IDs, for the second batch's exclude list. */
function rawPostIds(items: unknown[]): string[] {
  return items
    .map((item) => (item && typeof item === 'object' ? (item as { post_id?: unknown }).post_id : null))
    .filter((id): id is string | number => typeof id === 'string' || typeof id === 'number')
    .map(String);
}

/**
 * Keeps the first copy of each post. A second batch may repeat the first.
 * A post with no ID cannot be matched, so it is kept.
 */
function uniqueByPostId<T extends { postId: string | null }>(candidates: T[]): T[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (!candidate.postId) return true;
    if (seen.has(candidate.postId)) return false;
    seen.add(candidate.postId);
    return true;
  });
}

/**
 * Fetch the second posts batch, or nothing.
 *
 * Runs only when the first batch came back full: a short first batch means the
 * profile has no more posts. The job ID is saved before polling, so a restart
 * resumes the same paid job instead of starting another. Every failure here
 * returns nothing and leaves the first batch's result in place.
 */
async function fetchSecondBatch(
  deps: ExtractionDeps,
  extractionId: string,
  record: { platform: string; canonicalProfileUrl: string; topUpRunId?: string | null },
  firstItems: unknown[],
): Promise<unknown[]> {
  const { config, store } = deps;
  const platform = record.platform as SupportedPlatform;
  let jobId = record.topUpRunId ?? null;

  if (!jobId) {
    if (topUpBatchSize(config) <= 0 || firstItems.length < config.maxPostsPerProfile) return [];

    const scrapers = config.scrapers[platform];
    const started = await deps.gateway.startJob({
      datasetId: scrapers.posts.datasetId,
      discoverBy: scrapers.posts.discoverBy,
      input: buildTopUpInput(platform, record.canonicalProfileUrl, config, rawPostIds(firstItems)),
    });
    if (!started.ok) {
      log(deps, 'second batch did not start', {
        id: extractionId,
        ambiguous: started.ambiguous,
        message: started.message,
      });
      return [];
    }
    jobId = started.runId;
    await store.guestProfileExtraction.update({
      where: { id: extractionId },
      data: { topUpRunId: jobId, updatedAt: now(deps) },
    });
  }

  try {
    const outcome = await pollJob(deps, jobId);
    if (outcome.kind === 'timeout') await deps.gateway.cancelJob(jobId);
    if (outcome.kind !== 'done' || outcome.snapshot.state !== 'SUCCEEDED') {
      log(deps, 'second batch gave no posts', {
        id: extractionId,
        jobId,
        state: outcome.kind === 'done' ? outcome.snapshot.state : outcome.kind,
      });
      return [];
    }
    return await deps.gateway.listItems(jobId);
  } catch (error) {
    log(deps, 'second batch could not be read', { id: extractionId, jobId, message: (error as Error)?.message });
    return [];
  }
}

/**
 * Provider thumbnail URLs expire and cannot be hotlinked, so the browser falls
 * back to the provider embed. A failed copy keeps the original URL.
 */
async function cacheSelectedThumbnails<T extends { postId: string; thumbnailUrl?: string | null }>(
  deps: ExtractionDeps,
  platform: string,
  posts: T[],
): Promise<T[]> {
  const { cacheThumbnail } = deps;
  if (!cacheThumbnail) return posts;
  return Promise.all(
    posts.map(async (post) => {
      if (!post.thumbnailUrl) return post;
      try {
        const cached = await cacheThumbnail(post.thumbnailUrl, platform, post.postId);
        return cached ? { ...post, thumbnailUrl: cached } : post;
      } catch (error) {
        log(deps, 'thumbnail copy failed', { postId: post.postId, message: (error as Error)?.message });
        return post;
      }
    }),
  );
}

/* ---------------------------------------------------------- Reconciliation */

export interface ReconcileReport {
  requeued: string[];
  resumed: string[];
  exhausted: string[];
  /** Not looked up this pass: the pass limit was reached, or Bright Data answered 429. */
  deferred: string[];
  /** Lookups that threw. Each is retried next pass without using up an attempt. */
  errored: string[];
  rateLimited: boolean;
}

/**
 * Recover work after a restart.
 *
 * A queued or polling record is re-enqueued. An ambiguous start is matched
 * against the posts dataset's recent jobs, by the profile URL in each job's
 * input. Nothing here ever starts a new job.
 */
export async function reconcileExtractions(
  deps: ExtractionDeps,
  options: { staleAfterMs?: number } = {},
): Promise<ReconcileReport> {
  const { store, config } = deps;
  const at = now(deps);
  const staleBefore = new Date(at.getTime() - (options.staleAfterMs ?? 60_000));

  const report: ReconcileReport = {
    requeued: [],
    resumed: [],
    exhausted: [],
    deferred: [],
    errored: [],
    rateLimited: false,
  };
  let lookups = 0;

  const recoverable = await store.guestProfileExtraction.findMany({
    where: {
      status: { in: [...ACTIVE_STATUSES, 'REQUIRES_RECONCILIATION'] },
      updatedAt: { lte: staleBefore },
    },
  });

  for (const record of recoverable) {
    if (record.status !== 'REQUIRES_RECONCILIATION') {
      // eslint-disable-next-line no-await-in-loop
      await deps.enqueue(record.id);
      report.requeued.push(record.id);
      continue;
    }

    if (record.reconcileAttempts >= MAX_RECONCILE_ATTEMPTS) {
      // eslint-disable-next-line no-await-in-loop
      await markFailed(
        deps,
        record.id,
        'RECONCILIATION_FAILED',
        'The ambiguous job could not be matched. No second job was started.',
      );
      report.exhausted.push(record.id);
      continue;
    }

    // Bounded, so one pass can never burst toward Bright Data's 429
    // blacklist. After a 429, nothing else is sent until the next pass.
    if (report.rateLimited || lookups >= MAX_RECONCILE_LOOKUPS_PER_PASS) {
      report.deferred.push(record.id);
      continue;
    }
    lookups += 1;

    try {
      // eslint-disable-next-line no-await-in-loop
      const match = await findOwnJob(deps, record);

      if (match) {
        // eslint-disable-next-line no-await-in-loop
        await store.guestProfileExtraction.update({
          where: { id: record.id },
          data: { actorRunId: match.jobId, status: 'POLLING', updatedAt: at },
        });
        // eslint-disable-next-line no-await-in-loop
        await deps.enqueue(record.id);
        report.resumed.push(record.id);
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      await store.guestProfileExtraction.update({
        where: { id: record.id },
        data: { reconcileAttempts: record.reconcileAttempts + 1, lastReconciledAt: at, updatedAt: at },
      });
    } catch (error) {
      // A failed lookup says nothing about whether the job exists, so it does
      // not use up an attempt. One row's error never stops the other rows.
      if (error instanceof RateLimitedError) {
        report.rateLimited = true;
        report.deferred.push(record.id);
      } else {
        report.errored.push(record.id);
      }
      log(deps, 'reconciliation lookup failed', { id: record.id, message: (error as Error)?.message });
    }
  }

  log(deps, 'reconciliation finished', { ...report });
  return report;
}

/**
 * Find the job an ambiguous start created, if any.
 *
 * Job IDs other rows already own are excluded, so two rows never share one
 * job: another admin may have fetched the same profile in the same window.
 * The gateway ranks a running or ready job above a failed or canceled one.
 */
async function findOwnJob(deps: ExtractionDeps, record: any): Promise<JobSnapshot | null> {
  const scrapers = deps.config.scrapers[record.platform as SupportedPlatform];
  const since = new Date(record.createdAt);

  // A second-batch job runs the same posts dataset on the same profile URL,
  // so it is owned too. Adopting one as a first batch would rate old posts.
  const others = await deps.store.guestProfileExtraction.findMany({
    where: {
      canonicalProfileKey: record.canonicalProfileKey,
      OR: [{ actorRunId: { not: null } }, { topUpRunId: { not: null } }],
      id: { not: record.id },
      createdAt: { gte: new Date(since.getTime() - 86_400_000) },
    },
  });
  const excludeJobIds = others
    .filter((row) => row.id !== record.id)
    .flatMap((row) => [row.actorRunId, row.topUpRunId])
    .filter((jobId): jobId is string => typeof jobId === 'string');

  const matches = await deps.gateway.findRecentJobs(scrapers.posts.datasetId, since, record.canonicalProfileUrl, {
    excludeJobIds,
  });
  return matches[0] ?? null;
}

/* -------------------------------------------------------- Cleanup and health */

/**
 * Remove expired extraction rows.
 *
 * `GuestCreatorMetricAudit.extractionId` is `ON DELETE SET NULL`, so an audit
 * keeps its dataset ID, contract version, job ID, formula version, and both value sets.
 */
export async function cleanupExpiredExtractions(deps: ExtractionDeps): Promise<{ deleted: number }> {
  const result = await deps.store.guestProfileExtraction.deleteMany({
    where: {
      expiresAt: { lte: now(deps) },
      status: { in: [...TERMINAL_STATUSES] },
      pendingPitches: { none: {} },
    },
  });
  return { deleted: result.count };
}

export interface ExtractionHealth {
  healthy: boolean;
  active: number;
  stuck: number;
  requiresReconciliation: number;
  alerts: string[];
}

export async function getExtractionHealth(
  deps: ExtractionDeps,
  options: { stuckAfterMs?: number } = {},
): Promise<ExtractionHealth> {
  const { store } = deps;
  const at = now(deps);
  const stuckBefore = new Date(at.getTime() - (options.stuckAfterMs ?? 10 * 60_000));

  const [active, stuck, requiresReconciliation, schemaChanges] = await Promise.all([
    store.guestProfileExtraction.count({ where: { status: { in: [...ACTIVE_STATUSES] } } }),
    store.guestProfileExtraction.count({
      where: { status: { in: [...ACTIVE_STATUSES] }, updatedAt: { lte: stuckBefore } },
    }),
    store.guestProfileExtraction.count({ where: { status: 'REQUIRES_RECONCILIATION' } }),
    store.guestProfileExtraction.count({
      where: { failureCode: 'PROVIDER_SCHEMA_CHANGED', updatedAt: { gte: new Date(at.getTime() - 86_400_000) } },
    }),
  ]);

  const alerts: string[] = [];
  if (stuck > 0) alerts.push(`${stuck} extraction(s) have not moved for 10 minutes.`);
  if (requiresReconciliation > 0) alerts.push(`${requiresReconciliation} extraction(s) need reconciliation.`);
  if (schemaChanges > 0) alerts.push(`${schemaChanges} provider schema change(s) in the last day.`);

  return { healthy: alerts.length === 0, active, stuck, requiresReconciliation, alerts };
}

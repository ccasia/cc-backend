import crypto from 'crypto';

import { buildActorInput, needsProfileRun, type ExtractionConfig } from '@configs/guestProfileExtractionConfig';
import type {
  AdapterResult,
  CanonicalProfile,
  MetricBaseline,
  SupportedPlatform,
} from '@/src/types/guestProfileExtraction';
import { parseInstagramActorOutput } from './actorAdapters/instagramActorAdapter';
import { parseTiktokActorOutput } from './actorAdapters/tiktokActorAdapter';
import type { ApifyGateway, RunSnapshot } from './apifyGateway';
import { computeEngagementRate, formatEngagementRatePercent } from './engagementRateCalculator';
import { createReceiptNonce, digestResult } from './extractionReceiptService';
import { normalizeProfileUrl } from './profileUrlNormalizer';
import { applyValidPostPolicy, markSampleInCandidates, selectSample } from './validPostPolicy';

/**
 * Orchestration for one durable unit of provider work.
 *
 * The order is fixed and the tests hold it in place:
 *  1. Persist the extraction row.
 *  2. Enqueue the job.
 *  3. Persist the Apify run ID.
 *  4. Poll.
 *
 * An ambiguous start becomes REQUIRES_RECONCILIATION. It never starts a second
 * paid run. Strict one-run behaviour is not claimed until actor certification
 * proves it.
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
  gateway: ApifyGateway;
  config: ExtractionConfig;
  enqueue(extractionId: string): Promise<void>;
  now?(): Date;
  sleep?(ms: number): Promise<void>;
  log?(message: string, context?: Record<string, unknown>): void;
}

export const ACTIVE_STATUSES = ['QUEUED', 'RUNNING', 'POLLING'] as const;
export const TERMINAL_STATUSES = ['READY', 'INSUFFICIENT_DATA', 'FAILED', 'CANCELLED', 'STALE'] as const;

const MAX_POLL_ATTEMPTS = 12;
const BASE_POLL_DELAY_MS = 1_000;
const MAX_POLL_DELAY_MS = 8_000;
const MAX_RECONCILE_ATTEMPTS = 5;

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
  actorId: string;
  actorBuild: string;
  maxDatasetItems: number;
}): string {
  return crypto
    .createHash('sha256')
    .update(
      [input.canonicalProfileKey, input.platform, input.actorId, input.actorBuild, input.maxDatasetItems].join('|'),
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

  const actor = config.actors[profile.platform];
  const fingerprint = workFingerprint({
    canonicalProfileKey: profile.canonicalKey,
    platform: profile.platform,
    actorId: actor.actorId,
    actorBuild: actor.build,
    maxDatasetItems: config.maxDatasetItems,
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

  // Cache reuse. A completed result for the same work, on the same pinned
  // build, inside the window, saves a paid run.
  const cached =
    config.cacheTtlMs > 0
      ? await store.guestProfileExtraction.findFirst({
          where: {
            canonicalProfileKey: profile.canonicalKey,
            platform: profile.platform,
            actorBuild: actor.build,
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
    actorId: actor.actorId,
    actorBuild: actor.build,
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
        resultFollowerCount: cached.resultFollowerCount,
        resultEngagementRate: cached.resultEngagementRate,
        sampleSize: cached.sampleSize,
        formulaVersion: cached.formulaVersion,
        selectedPosts: cached.selectedPosts,
        unverifiedFlags: cached.unverifiedFlags ?? [],
        startedAt: at,
        completedAt: at,
        expiresAt: new Date(at.getTime() + config.retentionMs),
        // No paid run happened here. The cost stays on the row that paid.
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
  config: ExtractionConfig,
  profileItems: unknown[] | null,
): AdapterResult {
  return platform === 'instagram'
    ? parseInstagramActorOutput({ items, profileItems, expectedUsername })
    : parseTiktokActorOutput({ items, expectedUsername });
}

/**
 * Read the secondary profile run, where one was started.
 *
 * Best effort by design. The follower count is not part of the v2 formula, so
 * a profile run that fails must not cost the admin the whole rate. The run ID
 * was persisted at start, so the charge is recorded either way.
 */
async function readProfileRun(
  deps: ExtractionDeps,
  record: { profileActorRunId?: string | null },
): Promise<{ items: unknown[] | null; costUsd: number | null }> {
  const runId = record.profileActorRunId;
  if (!runId) return { items: null, costUsd: null };

  try {
    let snapshot: RunSnapshot | null = null;
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop
      snapshot = await deps.gateway.getRun(runId);
      if (snapshot && !['READY', 'RUNNING', 'ABORTING', 'TIMING-OUT'].includes(snapshot.state)) break;
      // eslint-disable-next-line no-await-in-loop
      await sleep(deps, pollDelay(attempt));
    }

    if (!snapshot || snapshot.state !== 'SUCCEEDED' || !snapshot.defaultDatasetId) {
      log(deps, 'profile run gave no follower count', { runId, state: snapshot?.state ?? 'unreadable' });
      return { items: null, costUsd: snapshot?.costUsd ?? null };
    }

    const items = await deps.gateway.listDatasetItems(snapshot.defaultDatasetId, 5);
    return { items, costUsd: snapshot.costUsd };
  } catch (error) {
    log(deps, 'profile run could not be read', { runId, message: (error as Error)?.message });
    return { items: null, costUsd: null };
  }
}

/**
 * Run one extraction to a terminal state.
 *
 * Safe to call again. A record that already finished is left alone, and a
 * record that already has a run ID resumes polling instead of starting again.
 */
export async function processExtraction(extractionId: string, deps: ExtractionDeps): Promise<void> {
  const { store, config } = deps;
  const record = await store.guestProfileExtraction.findUnique({ where: { id: extractionId } });
  if (!record) return;
  if ((TERMINAL_STATUSES as readonly string[]).includes(record.status)) return;
  if (record.status === 'REQUIRES_RECONCILIATION') return;

  const actor = config.actors[record.platform as SupportedPlatform];
  let runId: string | null = record.actorRunId ?? null;

  if (!runId) {
    const started = await deps.gateway.startRun({
      actorId: actor.actorId,
      build: actor.build,
      input: buildActorInput(record.platform, record.canonicalProfileUrl, config),
      timeoutSecs: config.runTimeoutSeconds,
      maxItems: config.maxDatasetItems,
    });

    if (!started.ok && started.ambiguous) {
      // The call may have started a paid run. Reconciliation looks for it.
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

    // Persist the run ID before any polling, so a restart can resume it.
    runId = started.runId;
    await store.guestProfileExtraction.update({
      where: { id: extractionId },
      data: { actorRunId: runId, status: 'RUNNING', startedAt: now(deps), updatedAt: now(deps) },
    });
  }

  // Instagram only, and only once. The follower count run is cheap and
  // short, and the rate does not depend on it, so nothing in here may fail
  // the extraction. The catch covers the store as well as the provider: a
  // worker running an older Prisma Client would otherwise throw on the new
  // column and lose a run that had already been paid for.
  if (needsProfileRun(record.platform as SupportedPlatform) && !record.profileActorRunId) {
    try {
      const profileRun = await deps.gateway.startRun({
        actorId: actor.actorId,
        build: actor.build,
        input: buildActorInput(record.platform, record.canonicalProfileUrl, config, 'profile'),
        timeoutSecs: config.runTimeoutSeconds,
        maxItems: 5,
      });

      if (!profileRun.ok) {
        log(deps, 'profile run did not start', { id: extractionId, message: profileRun.message });
      } else {
        await store.guestProfileExtraction.update({
          where: { id: extractionId },
          data: { profileActorRunId: profileRun.runId, updatedAt: now(deps) },
        });
        record.profileActorRunId = profileRun.runId;
      }
    } catch (error) {
      log(deps, 'profile run could not be recorded', {
        id: extractionId,
        message: (error as Error)?.message,
      });
    }
  }

  await store.guestProfileExtraction.update({
    where: { id: extractionId },
    data: { status: 'POLLING', updatedAt: now(deps) },
  });

  let snapshot: RunSnapshot | null = null;
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    snapshot = await deps.gateway.getRun(runId);
    if (snapshot && !['READY', 'RUNNING', 'ABORTING', 'TIMING-OUT'].includes(snapshot.state)) break;
    // eslint-disable-next-line no-await-in-loop
    await sleep(deps, pollDelay(attempt));
  }

  if (!snapshot) {
    await markFailed(deps, extractionId, 'RUN_NOT_FOUND', `Run ${runId} could not be read.`);
    return;
  }
  if (['READY', 'RUNNING', 'ABORTING', 'TIMING-OUT'].includes(snapshot.state)) {
    await markFailed(deps, extractionId, 'POLL_TIMEOUT', 'The run did not finish inside the polling window.');
    return;
  }
  if (snapshot.state !== 'SUCCEEDED') {
    await markFailed(deps, extractionId, snapshot.state.replace('-', '_'), `The provider run ended ${snapshot.state}.`);
    return;
  }
  if (snapshot.buildNumber && snapshot.buildNumber !== actor.build) {
    await markFailed(
      deps,
      extractionId,
      'BUILD_MISMATCH',
      `Expected build ${actor.build} but the run used ${snapshot.buildNumber}.`,
    );
    return;
  }
  if (config.maxCostUsdPerRun !== null && snapshot.costUsd !== null && snapshot.costUsd > config.maxCostUsdPerRun) {
    await store.guestProfileExtraction.update({
      where: { id: extractionId },
      data: {
        status: 'FAILED',
        failureCode: 'COST_LIMIT',
        failureMessage: `The run charged ${snapshot.costUsd} USD, above the ${config.maxCostUsdPerRun} USD cap.`,
        costUsd: snapshot.costUsd,
        completedAt: now(deps),
        updatedAt: now(deps),
      },
    });
    return;
  }
  if (!snapshot.defaultDatasetId) {
    await markFailed(deps, extractionId, 'NO_DATASET', 'The run produced no dataset.');
    return;
  }

  const items = await deps.gateway.listDatasetItems(snapshot.defaultDatasetId, config.maxDatasetItems);
  const profileRun = await readProfileRun(deps, record);
  const username = record.canonicalProfileKey.split(':')[1] ?? '';
  const parsed = runAdapter(record.platform, items, username, config, profileRun.items);

  const at = now(deps);
  const common = {
    actorDatasetId: snapshot.defaultDatasetId,
    // Measured, never estimated. Release gate 2 reads this.
    costUsd: snapshot.costUsd,
    profileCostUsd: profileRun.costUsd,
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

  const policy = applyValidPostPolicy(parsed.candidates, { ownerHandle: username, now: at });
  const sample = selectSample(policy.valid);

  if (!sample.ok) {
    await store.guestProfileExtraction.update({
      where: { id: extractionId },
      data: {
        ...common,
        status: 'INSUFFICIENT_DATA',
        sampleSize: sample.validCount,
        unverifiedFlags: policy.unverifiedFlags,
        // Kept on purpose. This is the evidence for why ten were not found.
        candidatePosts: policy.evaluated,
        failureCode: 'INSUFFICIENT_DATA',
        failureMessage: `Only ${sample.validCount} of the required ${sample.required} valid posts were found.`,
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
      resultFollowerCount: baseline.followerCount,
      resultEngagementRate: baseline.engagementRate,
      sampleSize: rate.sampleSize,
      formulaVersion: rate.formulaId,
      selectedPosts: rate.evidence,
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

/* ---------------------------------------------------------- Reconciliation */

export interface ReconcileReport {
  requeued: string[];
  resumed: string[];
  exhausted: string[];
}

/**
 * Recover work after a restart.
 *
 * A queued or polling record is re-enqueued. An ambiguous start is matched
 * against the actor's recent runs. Nothing here ever starts a new run.
 */
export async function reconcileExtractions(
  deps: ExtractionDeps,
  options: { staleAfterMs?: number } = {},
): Promise<ReconcileReport> {
  const { store, config } = deps;
  const at = now(deps);
  const staleBefore = new Date(at.getTime() - (options.staleAfterMs ?? 60_000));

  const report: ReconcileReport = { requeued: [], resumed: [], exhausted: [] };

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
        'The ambiguous run could not be matched. No second run was started.',
      );
      report.exhausted.push(record.id);
      continue;
    }

    const actor = config.actors[record.platform as SupportedPlatform];
    // eslint-disable-next-line no-await-in-loop
    const candidates = await deps.gateway.findRecentRun(actor.actorId, new Date(record.createdAt));
    const match = candidates.find((run) => run.buildNumber === null || run.buildNumber === actor.build);

    if (match) {
      // eslint-disable-next-line no-await-in-loop
      await store.guestProfileExtraction.update({
        where: { id: record.id },
        data: { actorRunId: match.runId, status: 'POLLING', updatedAt: at },
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
  }

  log(deps, 'reconciliation finished', { ...report });
  return report;
}

/* -------------------------------------------------------- Cleanup and health */

/**
 * Remove expired extraction rows.
 *
 * `GuestCreatorMetricAudit.extractionId` is `ON DELETE SET NULL`, so an audit
 * keeps its actor build, run ID, formula version, and both value sets.
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

  const [active, stuck, requiresReconciliation, schemaChanges, costLimits] = await Promise.all([
    store.guestProfileExtraction.count({ where: { status: { in: [...ACTIVE_STATUSES] } } }),
    store.guestProfileExtraction.count({
      where: { status: { in: [...ACTIVE_STATUSES] }, updatedAt: { lte: stuckBefore } },
    }),
    store.guestProfileExtraction.count({ where: { status: 'REQUIRES_RECONCILIATION' } }),
    store.guestProfileExtraction.count({
      where: { failureCode: 'PROVIDER_SCHEMA_CHANGED', updatedAt: { gte: new Date(at.getTime() - 86_400_000) } },
    }),
    store.guestProfileExtraction.count({
      where: { failureCode: 'COST_LIMIT', updatedAt: { gte: new Date(at.getTime() - 86_400_000) } },
    }),
  ]);

  const alerts: string[] = [];
  if (stuck > 0) alerts.push(`${stuck} extraction(s) have not moved for 10 minutes.`);
  if (requiresReconciliation > 0) alerts.push(`${requiresReconciliation} extraction(s) need reconciliation.`);
  if (schemaChanges > 0) alerts.push(`${schemaChanges} provider schema change(s) in the last day.`);
  if (costLimits > 0) alerts.push(`${costLimits} run(s) hit the cost cap in the last day.`);

  return { healthy: alerts.length === 0, active, stuck, requiresReconciliation, alerts };
}

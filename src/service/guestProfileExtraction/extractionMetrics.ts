import type { SupportedPlatform } from '@/src/types/guestProfileExtraction';

/**
 * Canary measurements for the rollout.
 *
 * Every number here comes from a stored value, not an estimate. Cost is the
 * amount the provider actually charged, read off each run.
 */

export interface MetricsStore {
  guestProfileExtraction: {
    findMany(args: { where: any; select?: any }): Promise<any[]>;
  };
}

export interface ExtractionMetrics {
  windowStart: string;
  windowEnd: string;
  total: number;

  /** Outcome counts. */
  ready: number;
  insufficientData: number;
  failed: number;
  requiresReconciliation: number;
  active: number;

  /** Rates as fractions of finished work, 0 to 1. */
  successRate: number | null;
  insufficientDataRate: number | null;
  schemaFailureRate: number | null;

  /** Failure codes, most common first. */
  failuresByCode: { code: string; count: number }[];

  /** Wall-clock duration from start to finish, in milliseconds. */
  durationMs: { count: number; p50: number | null; p95: number | null; max: number | null };

  /** Reuse and repeat asks. */
  cacheHits: number;
  cacheHitRate: number | null;
  duplicateStartAttempts: number;

  /** Recovery health. */
  reconciliationFailures: number;
  reconcileAttemptsTotal: number;

  /** Measured provider charges. Null when nothing was charged yet. */
  cost: {
    paidRuns: number;
    totalUsd: number | null;
    meanUsdPerRun: number | null;
    maxUsdPerRun: number | null;
    byPlatform: { platform: SupportedPlatform; paidRuns: number; totalUsd: number }[];
  };
}

const TERMINAL = ['READY', 'INSUFFICIENT_DATA', 'FAILED', 'CANCELLED', 'STALE'];
const ACTIVE = ['QUEUED', 'RUNNING', 'POLLING'];

const percentile = (sorted: number[], fraction: number): number | null => {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.floor(fraction * sorted.length));
  return sorted[index];
};

const rate = (part: number, whole: number): number | null => (whole === 0 ? null : part / whole);

/** A Prisma Decimal, a number, or nothing. */
const toNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export async function collectExtractionMetrics(
  store: MetricsStore,
  options: { since: Date; until?: Date; campaignId?: string },
): Promise<ExtractionMetrics> {
  const until = options.until ?? new Date();

  const rows = await store.guestProfileExtraction.findMany({
    where: {
      createdAt: { gte: options.since, lte: until },
      ...(options.campaignId ? { campaignId: options.campaignId } : {}),
    },
    select: {
      platform: true,
      status: true,
      failureCode: true,
      startedAt: true,
      completedAt: true,
      costUsd: true,
      reusedFromExtractionId: true,
      duplicateStartAttempts: true,
      reconcileAttempts: true,
    },
  });

  const count = (predicate: (row: any) => boolean) => rows.filter(predicate).length;

  const ready = count((r) => r.status === 'READY');
  const insufficientData = count((r) => r.status === 'INSUFFICIENT_DATA');
  const failed = count((r) => r.status === 'FAILED');
  const finished = count((r) => TERMINAL.includes(r.status));

  const failureCounts = new Map<string, number>();
  rows
    .filter((r) => r.status === 'FAILED' && r.failureCode)
    .forEach((r) => failureCounts.set(r.failureCode, (failureCounts.get(r.failureCode) ?? 0) + 1));

  const durations = rows
    .filter((r) => r.startedAt && r.completedAt)
    .map((r) => new Date(r.completedAt).getTime() - new Date(r.startedAt).getTime())
    .filter((ms) => ms >= 0)
    .sort((a, b) => a - b);

  const cacheHits = count((r) => Boolean(r.reusedFromExtractionId));

  // A reused row paid nothing. Only rows with a real charge count as paid.
  const paid = rows
    .map((r) => ({ platform: r.platform as SupportedPlatform, usd: toNumber(r.costUsd) }))
    .filter((r): r is { platform: SupportedPlatform; usd: number } => r.usd !== null && r.usd > 0);

  const byPlatform = (['instagram', 'tiktok'] as SupportedPlatform[])
    .map((platform) => {
      const forPlatform = paid.filter((r) => r.platform === platform);
      return {
        platform,
        paidRuns: forPlatform.length,
        totalUsd: forPlatform.reduce((sum, r) => sum + r.usd, 0),
      };
    })
    .filter((entry) => entry.paidRuns > 0);

  const totalUsd = paid.reduce((sum, r) => sum + r.usd, 0);

  return {
    windowStart: options.since.toISOString(),
    windowEnd: until.toISOString(),
    total: rows.length,

    ready,
    insufficientData,
    failed,
    requiresReconciliation: count((r) => r.status === 'REQUIRES_RECONCILIATION'),
    active: count((r) => ACTIVE.includes(r.status)),

    successRate: rate(ready, finished),
    insufficientDataRate: rate(insufficientData, finished),
    schemaFailureRate: rate(failureCounts.get('PROVIDER_SCHEMA_CHANGED') ?? 0, finished),

    failuresByCode: [...failureCounts.entries()]
      .map(([code, value]) => ({ code, count: value }))
      .sort((a, b) => b.count - a.count),

    durationMs: {
      count: durations.length,
      p50: percentile(durations, 0.5),
      p95: percentile(durations, 0.95),
      max: durations.length > 0 ? durations[durations.length - 1] : null,
    },

    cacheHits,
    cacheHitRate: rate(cacheHits, rows.length),
    duplicateStartAttempts: rows.reduce((sum, r) => sum + (r.duplicateStartAttempts ?? 0), 0),

    reconciliationFailures: count((r) => r.failureCode === 'RECONCILIATION_FAILED'),
    reconcileAttemptsTotal: rows.reduce((sum, r) => sum + (r.reconcileAttempts ?? 0), 0),

    cost: {
      paidRuns: paid.length,
      totalUsd: paid.length > 0 ? totalUsd : null,
      meanUsdPerRun: paid.length > 0 ? totalUsd / paid.length : null,
      maxUsdPerRun: paid.length > 0 ? Math.max(...paid.map((r) => r.usd)) : null,
      byPlatform,
    },
  };
}

/**
 * Compare measured cost against the approved budget.
 *
 * Pricing is a release input. This never assumes a price; it reads what the
 * provider charged and checks it against the configured cap.
 */
export function checkCostAgainstBudget(
  metrics: ExtractionMetrics,
  budget: { maxUsdPerRun: number | null; maxUsdPerWindow?: number | null },
): { ok: boolean; problems: string[] } {
  const problems: string[] = [];

  if (budget.maxUsdPerRun === null) {
    problems.push('APIFY_MAX_COST_USD_PER_RUN is not set. Measure one run and set it before release.');
  } else if (metrics.cost.maxUsdPerRun !== null && metrics.cost.maxUsdPerRun > budget.maxUsdPerRun) {
    problems.push(`A run charged ${metrics.cost.maxUsdPerRun} USD, above the ${budget.maxUsdPerRun} USD cap.`);
  }

  if (
    budget.maxUsdPerWindow != null &&
    metrics.cost.totalUsd !== null &&
    metrics.cost.totalUsd > budget.maxUsdPerWindow
  ) {
    problems.push(`The window charged ${metrics.cost.totalUsd} USD, above the ${budget.maxUsdPerWindow} USD budget.`);
  }

  if (metrics.cost.paidRuns === 0) {
    problems.push('No measured charge recorded yet. Release gate 2 needs at least one real run.');
  }

  return { ok: problems.length === 0, problems };
}

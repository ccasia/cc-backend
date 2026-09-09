import type {
  EvaluatedCandidate,
  PostCandidate,
  RejectedPost,
  SampleSelectionResult,
  SupportedPlatform,
  UnverifiableFlag,
  ValidPost,
  ValidPostPolicyResult,
} from '@/src/types/guestProfileExtraction';

/**
 * One valid-post policy for both platforms.
 *
 * A candidate must be creator-owned, public, unique by stable post ID, dated
 * with a valid publication time, and supplied with safe non-negative integer
 * counters for its platform. A pinned, ad, sponsored, or repost item is never
 * a candidate. A missing counter is never read as zero.
 */

/** The sample is exactly ten posts. */
export const SAMPLE_SIZE = 10;

/** No platform published content before this date. */
const EARLIEST_POST = Date.UTC(2010, 0, 1);

/** Allowance for clock skew between the provider and this server. */
const FUTURE_SKEW_MS = 5 * 60 * 1000;

/**
 * Views are the denominator on both platforms, so both must supply one.
 *
 * This is what restricts the Instagram sample to Reels and video posts. The
 * actor reports `videoPlayCount` on those and nothing on a photo or a
 * carousel, so a photo is dropped as a missing counter.
 *
 * Saves are never required. No public Instagram source reports them, and the
 * TikTok actor may omit them.
 */
const REQUIRED_COUNTERS: Record<SupportedPlatform, readonly ('likes' | 'comments' | 'shares' | 'views')[]> = {
  instagram: ['likes', 'comments', 'views'],
  tiktok: ['likes', 'comments', 'shares', 'views'],
};

const FLAGS: readonly { field: UnverifiableFlag; code: RejectedPost['code'] }[] = [
  { field: 'isPinned', code: 'PINNED' },
  { field: 'isAd', code: 'AD' },
  { field: 'isSponsored', code: 'SPONSORED' },
  { field: 'isRepost', code: 'REPOST' },
];

const isSafeCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

function parsePublishedAt(raw: string | null, now: number): Date | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return null;
  if (ms < EARLIEST_POST) return null;
  if (ms > now + FUTURE_SKEW_MS) return null;
  return new Date(ms);
}

export interface ValidPostPolicyContext {
  /** Canonical lowercased handle of the requested creator. */
  ownerHandle: string;
  /** Injectable for tests. Defaults to the current time. */
  now?: Date;
}

export function applyValidPostPolicy(
  candidates: readonly PostCandidate[],
  context: ValidPostPolicyContext,
): ValidPostPolicyResult {
  const now = (context.now ?? new Date()).getTime();
  const owner = context.ownerHandle.trim().toLowerCase().replace(/^@/, '');

  const valid: ValidPost[] = [];
  const rejected: RejectedPost[] = [];
  const evaluated: EvaluatedCandidate[] = [];
  const unverified = new Set<UnverifiableFlag>();
  const seen = new Set<string>();

  candidates.forEach((candidate) => {
    const id = typeof candidate.postId === 'string' ? candidate.postId.trim() : '';

    // Every candidate is recorded, whatever the verdict.
    const record: EvaluatedCandidate = {
      postId: id || null,
      postUrl: candidate.postUrl,
      publishedAt: candidate.publishedAt,
      likes: candidate.likes,
      comments: candidate.comments,
      shares: candidate.shares,
      saves: candidate.saves,
      views: candidate.views,
      postType: candidate.postType,
      accepted: false,
      rejectedReason: null,
      usedInSample: false,
    };
    evaluated.push(record);

    const drop = (code: RejectedPost['code'], detail: string) => {
      record.rejectedReason = code;
      rejected.push({ postId: id || null, code, detail });
    };

    if (!id) {
      drop('MISSING_POST_ID', 'The provider returned no stable post ID.');
      return;
    }
    if (seen.has(id)) {
      drop('DUPLICATE_POST_ID', 'The provider returned this post more than once.');
      return;
    }
    seen.add(id);

    const handle =
      typeof candidate.ownerHandle === 'string' ? candidate.ownerHandle.trim().toLowerCase().replace(/^@/, '') : '';
    if (!handle || handle !== owner) {
      drop('OWNER_MISMATCH', `Expected ${owner} but the post reports ${handle || 'no author'}.`);
      return;
    }

    if (candidate.isPublic === false) {
      drop('NOT_PUBLIC', 'The provider marked this post as not public.');
      return;
    }
    if (candidate.isPublic === null) unverified.add('isPublic');

    const flagHit = FLAGS.find(({ field }) => candidate[field] === true);
    if (flagHit) {
      drop(flagHit.code, `The provider marked this post ${flagHit.field}.`);
      return;
    }
    FLAGS.forEach(({ field }) => {
      if (candidate[field] === null) unverified.add(field);
    });

    const publishedAt = parsePublishedAt(candidate.publishedAt, now);
    if (!publishedAt) {
      drop('INVALID_TIMESTAMP', `Publication time ${String(candidate.publishedAt)} is missing or not usable.`);
      return;
    }

    const required = REQUIRED_COUNTERS[candidate.platform];
    const missing = required.find((field) => candidate[field] === null || candidate[field] === undefined);
    if (missing) {
      drop('MISSING_COUNTER', `The provider returned no ${missing}. A missing counter is never read as zero.`);
      return;
    }
    const invalid = required.find((field) => !isSafeCount(candidate[field]));
    if (invalid) {
      drop('INVALID_COUNTER', `${invalid} is ${String(candidate[invalid])}, which is not a safe non-negative integer.`);
      return;
    }
    if (candidate.views === 0) {
      drop('ZERO_VIEWS', 'Views are the denominator and cannot be zero.');
      return;
    }

    record.accepted = true;
    valid.push({
      platform: candidate.platform,
      postId: id,
      postUrl: candidate.postUrl,
      publishedAt,
      likes: candidate.likes as number,
      comments: candidate.comments as number,
      shares: candidate.platform === 'tiktok' ? (candidate.shares as number) : null,
      // Optional, so it is carried as reported rather than required above.
      saves: typeof candidate.saves === 'number' ? candidate.saves : null,
      views: candidate.views as number,
      postType: candidate.postType,
      caption: typeof candidate.caption === 'string' && candidate.caption.trim() ? candidate.caption.trim() : null,
    });
  });

  return { valid, rejected, evaluated, unverifiedFlags: Array.from(unverified).sort() };
}

/**
 * Take the ten most recent valid posts among the actor candidates.
 *
 * Certification has not proved complete newest-first coverage for either
 * actor, so selection sorts by publication time here rather than trusting the
 * order the provider returned.
 */
/** Mark the candidates the formula used, so the stored record shows them. */
export function markSampleInCandidates(
  evaluated: EvaluatedCandidate[],
  sample: readonly { postId: string }[],
): EvaluatedCandidate[] {
  const used = new Set(sample.map((post) => post.postId));
  evaluated.forEach((candidate) => {
    candidate.usedInSample = candidate.postId !== null && used.has(candidate.postId);
  });
  return evaluated;
}

export function selectSample(valid: readonly ValidPost[]): SampleSelectionResult {
  if (valid.length < SAMPLE_SIZE) {
    return { ok: false, code: 'INSUFFICIENT_DATA', validCount: valid.length, required: SAMPLE_SIZE };
  }

  const posts = [...valid]
    .sort((a, b) => {
      const byTime = b.publishedAt.getTime() - a.publishedAt.getTime();
      // A stable tie-break keeps the sample deterministic.
      return byTime !== 0 ? byTime : a.postId.localeCompare(b.postId);
    })
    .slice(0, SAMPLE_SIZE);

  return { ok: true, posts };
}

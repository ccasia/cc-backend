import type {
  EngagementFormulaId,
  EngagementRateResult,
  SelectedPostEvidence,
  SupportedPlatform,
  ValidPost,
} from '@/src/types/guestProfileExtraction';
import { SAMPLE_SIZE } from './validPostPolicy';

/**
 * Versioned engagement rate formulas.
 *
 * Pure. The calculator never sees provider JSON; an adapter and the valid-post
 * policy run first. Full precision is kept here. Rounding happens only at a
 * display or persistence boundary, through `formatEngagementRatePercent`.
 */

export const FORMULA_IDS: Record<SupportedPlatform, EngagementFormulaId> = {
  instagram: 'instagram_recent_10_median_view_v2',
  tiktok: 'tiktok_recent_10_median_view_v2',
};

const isSafeCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Percentage as a string without the sign. `"4.27"` means 4.27%. */
export function formatEngagementRatePercent(value: number, decimals = 2): string {
  return value.toFixed(decimals);
}

/** Follower count as a string, for the `Pitch.followerCount` snapshot column. */
export function formatFollowerCount(value: number): string {
  return String(value);
}

/**
 * Median of a non-empty list.
 *
 * The sample is ten posts, so the count is even and the median is the mean of
 * the two middle values. The odd branch exists so the helper stays correct if
 * the sample size ever changes.
 */
export function medianOf(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * The v2 rate, shared by both platforms.
 *
 * `100 × (Σ(likes + comments + saves + shares) / n) / median(views)`
 *
 * A missing save or share count adds nothing rather than failing the post.
 * Instagram never reports either, so its numerator is likes plus comments. The
 * denominator is the median, not the mean, so one viral post cannot flatten
 * the rate of the nine around it.
 */
function medianViewRate(
  platform: SupportedPlatform,
  posts: readonly ValidPost[],
  followerCount: number | null,
): EngagementRateResult {
  const views: number[] = [];
  let totalEngagement = 0;
  let savesReported = false;

  for (const post of posts) {
    if (!isSafeCount(post.views) || post.views <= 0) {
      return {
        ok: false,
        code: 'INVALID_POST',
        message: `Post ${post.postId} has no usable view count, which the formula divides by.`,
      };
    }
    if (isSafeCount(post.saves)) savesReported = true;

    // An unreported optional counter contributes nothing. It is never guessed.
    totalEngagement +=
      post.likes +
      post.comments +
      (isSafeCount(post.saves) ? post.saves : 0) +
      (isSafeCount(post.shares) ? post.shares : 0);
    views.push(post.views);
  }

  const meanEngagement = totalEngagement / posts.length;
  const medianViews = medianOf(views);

  const evidence: SelectedPostEvidence[] = posts.map((post) => ({
    postId: post.postId,
    postUrl: post.postUrl,
    publishedAt: post.publishedAt.toISOString(),
    likes: post.likes,
    comments: post.comments,
    shares: post.shares,
    saves: post.saves,
    views: post.views,
    caption: post.caption,
    // v2 divides one mean by one median. No rate belongs to a single post.
    ratePercent: null,
  }));

  return {
    ok: true,
    formulaId: FORMULA_IDS[platform],
    engagementRatePercent: (100 * meanEngagement) / medianViews,
    sampleSize: posts.length,
    // Followers are no longer part of the rate. They stay on the result
    // because the guest creator record still shows a follower count.
    followerCount: isSafeCount(followerCount) ? followerCount : null,
    meanEngagement,
    medianViews,
    savesReported,
    evidence,
  };
}

export function computeEngagementRate(input: {
  platform: SupportedPlatform;
  posts: readonly ValidPost[];
  followerCount: number | null;
}): EngagementRateResult {
  const { platform, posts, followerCount } = input;

  if (posts.length !== SAMPLE_SIZE) {
    return {
      ok: false,
      code: 'WRONG_SAMPLE_SIZE',
      message: `The sample must be exactly ${SAMPLE_SIZE} posts, not ${posts.length}.`,
    };
  }
  if (posts.some((post) => post.platform !== platform)) {
    return { ok: false, code: 'INVALID_POST', message: 'The sample mixes platforms.' };
  }

  return medianViewRate(platform, posts, followerCount);
}

/**
 * Shared domain types for guest profile extraction.
 *
 * Provider JSON never reaches these types directly. A scraper adapter converts
 * `unknown` into a `PostCandidate`, and only then does the valid-post policy
 * and the formula registry see it.
 */

export type SupportedPlatform = 'instagram' | 'tiktok';

/* -------------------------------------------------------------- Identity */

export type ProfileUrlRejectionCode =
  | 'EMPTY'
  | 'MALFORMED_URL'
  | 'UNSUPPORTED_SCHEME'
  | 'USERINFO_NOT_ALLOWED'
  | 'PORT_NOT_ALLOWED'
  | 'UNSUPPORTED_HOST'
  | 'NOT_A_PROFILE_URL'
  | 'INVALID_USERNAME';

export interface CanonicalProfile {
  platform: SupportedPlatform;
  /** Lowercased. Identity is case-insensitive on both platforms. */
  username: string;
  /** HTTPS, `www` host, no query, no fragment, no trailing slash. */
  canonicalUrl: string;
  /** Stable identity key, for example `instagram:example`. */
  canonicalKey: string;
}

export type NormalizeProfileUrlResult =
  | { ok: true; profile: CanonicalProfile }
  | { ok: false; code: ProfileUrlRejectionCode; message: string };

/* ---------------------------------------------------------- Post candidate */

/**
 * One post as an adapter read it from the provider.
 *
 * `null` means the provider did not supply the value. A missing counter is
 * never read as zero.
 */
export interface PostCandidate {
  platform: SupportedPlatform;
  postId: string | null;
  postUrl: string | null;
  /** Image URL supplied by the saved provider result; absent on older records. */
  thumbnailUrl?: string | null;
  /** Author handle as the provider reported it. Compared case-insensitively. */
  ownerHandle: string | null;
  /**
   * Raw publication time from the provider, before parsing. Null when the
   * provider did not expose one: Bright Data's Instagram Reels listing often
   * has no `date_posted`, and the profile grid covers only twelve posts.
   */
  publishedAt: string | null;
  likes: number | null;
  comments: number | null;
  /** TikTok only. No Instagram source reports a share count. */
  shares: number | null;
  /**
   * TikTok `collect_count`. Never required: no public Instagram source reports
   * saves, and the TikTok scraper may omit the field. Absent counts as zero and
   * the result records that saves were not reported.
   */
  saves: number | null;
  /** The formula denominator on both platforms. Must be above zero. */
  views: number | null;
  isPinned: boolean | null;
  isAd: boolean | null;
  isSponsored: boolean | null;
  isRepost: boolean | null;
  /**
   * Instagram: the post has a co-author (a collab), whoever posted it. Product
   * decision 2026-09-30: collabs never count, because the engagement belongs
   * to both accounts. Null where the provider reports no co-authors (TikTok).
   */
  isCollab: boolean | null;
  /** Post-level visibility, where the provider reports it. */
  isPublic: boolean | null;
  /** Provider post type, for example `Video`, `Sidecar`, `photo`. */
  postType: string | null;
  /**
   * Public caption or post text. Optional: a missing caption does not fail the
   * post. Shown in the engagement breakdown so an admin can recognise the post.
   */
  caption: string | null;
  /** Position in the provider's list, from 0. The only order an undated post has. */
  sourceRank: number;
  /**
   * True when the provider's list order may stand in for a missing date.
   *
   * Instagram only. Bright Data lists Reels newest first but often omits the
   * publish date, so an undated Reel is kept and ordered by `sourceRank`, and
   * the row records `publishedAt` as unverified. TikTok always has a date, so
   * an undated TikTok post is still dropped.
   */
  undatedOrderTrusted: boolean;
}

/** A candidate that passed every rule. Counters are safe integers. */
export interface ValidPost {
  platform: SupportedPlatform;
  postId: string;
  postUrl: string | null;
  /** Image URL supplied by the saved provider result; absent on older records. */
  thumbnailUrl?: string | null;
  /** Null only for an Instagram Reel accepted on trusted list order. */
  publishedAt: Date | null;
  /** Position in the provider's list. Orders the sample when any date is missing. */
  sourceRank: number;
  likes: number;
  comments: number;
  /** TikTok only. */
  shares: number | null;
  /** TikTok only, and only when the scraper reported it. */
  saves: number | null;
  /** The formula denominator. Always above zero. */
  views: number | null;
  postType: string | null;
  /** Public caption when the provider reported one. */
  caption: string | null;
}

export type PostRejectionCode =
  | 'MISSING_POST_ID'
  | 'DUPLICATE_POST_ID'
  | 'OWNER_MISMATCH'
  | 'NOT_PUBLIC'
  | 'INVALID_TIMESTAMP'
  | 'MISSING_COUNTER'
  | 'INVALID_COUNTER'
  | 'ZERO_VIEWS'
  | 'PINNED'
  | 'AD'
  | 'SPONSORED'
  | 'REPOST'
  | 'COLLAB';

export interface RejectedPost {
  postId: string | null;
  code: PostRejectionCode;
  detail: string;
}

/**
 * Flags the provider did not report for a post that was otherwise accepted.
 *
 * An unreported flag cannot be checked. Certification
 * (cc-backend/docs/brightdata-setup.md) records which flags each Bright Data
 * dataset reports. `publishedAt` means at least one sampled post had no
 * publish date and was ordered by the provider's list order instead.
 */
export type UnverifiableFlag =
  | 'isPinned'
  | 'isAd'
  | 'isSponsored'
  | 'isRepost'
  | 'isCollab'
  | 'isPublic'
  | 'publishedAt';

/**
 * One candidate with the verdict the policy gave it.
 *
 * Kept for every candidate the provider returned, so an admin can see why a post
 * was left out and so a future rule change can be checked against real data.
 * Counters, IDs and an optional thumbnail URL. No avatar or bio.
 */
export interface EvaluatedCandidate {
  postId: string | null;
  postUrl: string | null;
  /** Image URL supplied by the saved provider result; absent on older records. */
  thumbnailUrl?: string | null;
  publishedAt: string | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  views: number | null;
  postType: string | null;
  accepted: boolean;
  rejectedReason: PostRejectionCode | null;
  /** True for the posts the formula actually used. */
  usedInSample: boolean;
}

export interface ValidPostPolicyResult {
  valid: ValidPost[];
  rejected: RejectedPost[];
  unverifiedFlags: UnverifiableFlag[];
  /** Every candidate, in the order the provider returned them. */
  evaluated: EvaluatedCandidate[];
}

export type SampleSelectionResult =
  | { ok: true; posts: ValidPost[] }
  | { ok: false; code: 'INSUFFICIENT_DATA'; validCount: number; required: number };

/* --------------------------------------------------------- Scraper adapters */

export type AdapterFailureCode =
  | 'PROVIDER_SCHEMA_CHANGED'
  | 'PRIVATE_PROFILE'
  | 'PROFILE_NOT_FOUND'
  | 'PROVIDER_FAILURE';

export interface ExtractedProfile {
  biography?: string | null;
  platform: SupportedPlatform;
  /** Lowercased handle as the provider reported it. */
  username: string;
  displayName: string | null;
  /** Provider CDN link. It expires, so the service copies it before saving. */
  profilePictureUrl?: string | null;
  /** Null when the profile job failed or did not report it. */
  followerCount: number | null;
  isPrivate: boolean;
}

export type AdapterResult =
  | { ok: true; profile: ExtractedProfile; candidates: PostCandidate[] }
  | { ok: false; code: AdapterFailureCode; message: string };

/** What an adapter receives. Provider content stays `unknown`. */
export interface AdapterInput {
  items: unknown;
  /**
   * Items from the profile job, which supplies the follower count and the
   * private flag on both platforms, and on Instagram the pinned flag and the
   * fallback date for the twelve newest grid posts. Absent when that job
   * failed: the rate is still produced, without a follower count.
   */
  profileItems?: unknown;
  /** Set when the job itself failed. */
  error?: { code?: unknown; message?: unknown } | null;
  /** Canonical handle that was requested. */
  expectedUsername: string;
}

/* -------------------------------------------------------- Formula registry */

/**
 * Every formula this backend has ever issued.
 *
 * A stored row keeps the ID that produced its number, so the v1 members stay
 * here after v2 ships. The UI keys its explanation on this value and must
 * never describe an old row with a new formula.
 */
export type EngagementFormulaId =
  | 'instagram_recent_5_followers_v1'
  | 'tiktok_recent_5_mean_view_rate_v1'
  | 'instagram_recent_10_median_view_v2'
  | 'tiktok_recent_10_median_view_v2';

/**
 * `MISSING_FOLLOWER_COUNT` is unreachable from v2 onwards, because followers
 * left the formula. It stays here for rows a v1 build wrote.
 */
export type FormulaFailureCode = 'MISSING_FOLLOWER_COUNT' | 'WRONG_SAMPLE_SIZE' | 'INVALID_POST';

/** One selected post, as shown to the admin. Optional thumbnail URL, no avatar or bio. */
export interface SelectedPostEvidence {
  postId: string;
  postUrl: string | null;
  /** Image URL supplied by the saved provider result; absent on older records. */
  thumbnailUrl?: string | null;
  /** ISO time. Null for an undated Instagram Reel ordered by provider rank. */
  publishedAt: string | null;
  likes: number;
  comments: number;
  shares: number | null;
  saves: number | null;
  views: number | null;
  /**
   * Public caption or post text when the provider reported one. Null when the
   * provider omitted it, or when an older stored row pre-dates this field.
   */
  caption: string | null;
  /**
   * Per-post rate. Only the v1 TikTok formula had one. v2 divides one mean by
   * one median, so there is no rate to attribute to a single post.
   */
  ratePercent: number | null;
}

export type EngagementRateResult =
  | {
      ok: true;
      formulaId: EngagementFormulaId;
      /** Full precision. Round only at display or persistence. */
      engagementRatePercent: number;
      sampleSize: number;
      followerCount: number | null;
      /** Mean total engagement across the sample. The numerator. */
      meanEngagement: number;
      /** Median views across the sample. The denominator. */
      medianViews: number;
      /** False when no post in the sample carried a save count. */
      savesReported: boolean;
      evidence: SelectedPostEvidence[];
    }
  | { ok: false; code: FormulaFailureCode; message: string };

/* ----------------------------------------------------------------- Receipt */

export interface ReceiptBindings {
  requesterUserId: string;
  campaignId: string;
  canonicalProfileKey: string;
  platform: SupportedPlatform;
  actorId: string;
  actorBuild: string;
  formulaVersion: string;
  /** Digest of the fetched baseline this receipt attests to. */
  resultDigest: string;
  extractionId: string;
}

export interface ReceiptPayload extends ReceiptBindings {
  v: 1;
  /** Single use. Consumed inside the create transaction. */
  nonce: string;
  issuedAt: string;
  expiresAt: string;
}

export type ReceiptFailureCode = 'MISSING' | 'MALFORMED' | 'BAD_SIGNATURE' | 'EXPIRED' | 'BINDING_MISMATCH';

export type ReceiptVerifyResult =
  | { ok: true; payload: ReceiptPayload }
  | { ok: false; code: ReceiptFailureCode; message: string; field?: keyof ReceiptBindings };

/** The values a receipt attests to. */
export interface MetricBaseline {
  name: string | null;
  followerCount: number | null;
  engagementRate: string | null;
}

export type MetricSource = 'automatic' | 'manual_override' | 'unavailable';

export interface MetricProvenance {
  source: MetricSource;
  overrideReason: string | null;
  original: MetricBaseline;
  final: MetricBaseline;
}

/**
 * Shared domain types for guest profile extraction.
 *
 * Provider JSON never reaches these types directly. An actor adapter converts
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
  /** Author handle as the provider reported it. Compared case-insensitively. */
  ownerHandle: string | null;
  /** Raw publication time from the provider, before parsing. */
  publishedAt: string | null;
  likes: number | null;
  comments: number | null;
  /** TikTok only. The Instagram actor reports no share count. */
  shares: number | null;
  /**
   * TikTok `collectCount`. Never required: no public Instagram source reports
   * saves, and the TikTok actor may omit the field. Absent counts as zero and
   * the result records that saves were not reported.
   */
  saves: number | null;
  /** The formula denominator on both platforms. Must be above zero. */
  views: number | null;
  isPinned: boolean | null;
  isAd: boolean | null;
  isSponsored: boolean | null;
  isRepost: boolean | null;
  /** Post-level visibility, where the provider reports it. */
  isPublic: boolean | null;
  /** Provider post type, for example `Video`, `Sidecar`, `photo`. */
  postType: string | null;
  /**
   * Public caption or post text. Optional: a missing caption does not fail the
   * post. Shown in the engagement breakdown so an admin can recognise the post.
   */
  caption: string | null;
}

/** A candidate that passed every rule. Counters are safe integers. */
export interface ValidPost {
  platform: SupportedPlatform;
  postId: string;
  postUrl: string | null;
  publishedAt: Date;
  likes: number;
  comments: number;
  /** TikTok only. */
  shares: number | null;
  /** TikTok only, and only when the actor reported it. */
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
  | 'REPOST';

export interface RejectedPost {
  postId: string | null;
  code: PostRejectionCode;
  detail: string;
}

/**
 * Flags the provider did not report for a post that was otherwise accepted.
 *
 * An unreported flag cannot be checked. Certification (04-apify-setup.md
 * section 4) must record which flags each pinned actor build reports.
 */
export type UnverifiableFlag = 'isPinned' | 'isAd' | 'isSponsored' | 'isRepost' | 'isPublic';

/**
 * One candidate with the verdict the policy gave it.
 *
 * Kept for every candidate the actor returned, so an admin can see why a post
 * was left out and so a future rule change can be checked against real data.
 * Counters and IDs only. No caption, no media URL, no avatar, no bio.
 */
export interface EvaluatedCandidate {
  postId: string | null;
  postUrl: string | null;
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
  /** Every candidate, in the order the actor returned them. */
  evaluated: EvaluatedCandidate[];
}

export type SampleSelectionResult =
  | { ok: true; posts: ValidPost[] }
  | { ok: false; code: 'INSUFFICIENT_DATA'; validCount: number; required: number };

/* ----------------------------------------------------------- Actor adapters */

export type AdapterFailureCode =
  | 'PROVIDER_SCHEMA_CHANGED'
  | 'PRIVATE_PROFILE'
  | 'PROFILE_NOT_FOUND'
  | 'PROVIDER_FAILURE';

export interface ExtractedProfile {
  platform: SupportedPlatform;
  /** Lowercased handle as the provider reported it. */
  username: string;
  displayName: string | null;
  /** Null when the actor mode does not report it. */
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
   * Instagram only. Items from the second, `details` run, which supplies the
   * follower count and the private flag. Absent when that run failed: the
   * rate is still produced, without a follower count.
   */
  profileItems?: unknown;
  /** Set when the run itself failed. */
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

/** One selected post, as shown to the admin. No media URL, no avatar, no bio. */
export interface SelectedPostEvidence {
  postId: string;
  postUrl: string | null;
  publishedAt: string;
  likes: number;
  comments: number;
  shares: number | null;
  saves: number | null;
  views: number | null;
  /**
   * Public caption or post text when the provider reported one. Null when the
   * actor omitted it, or when an older stored row pre-dates this field.
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

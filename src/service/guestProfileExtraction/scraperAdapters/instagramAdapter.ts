import { z } from 'zod';

import type { AdapterInput, AdapterResult, ExtractedProfile, PostCandidate } from '@/src/types/guestProfileExtraction';
import {
  asArray,
  counter,
  errorRowFailure,
  fail,
  flag,
  imageUrl,
  isErrorRow,
  normalizeHandle,
  profileCount,
  runFailure,
  text,
} from './adapterShared';

/**
 * Adapter for Bright Data's Instagram datasets, across two jobs.
 *
 * The Reels discovery (`gd_lyclm20il4r5helnj`, `discover_by=url_all_reels`)
 * supplies the post metrics. The Profiles dataset (`gd_l1vikfch901nx3by4`)
 * supplies the follower count, the private flag, and a `posts[]` grid of the
 * twelve newest posts.
 *
 * The grid matters for two fields the Reels output lacks:
 *  - `is_pinned`. No Reels item carries it. Bright Data documents it on the
 *    grid, but the live grid did not carry it either (measured 2026-09-30 on
 *    sooyaaa__ and esportspubgmobile), so every Reel records it unverified
 *    today. It is still read, in case the grid starts reporting it. An old
 *    pinned Reel falls out of the sample anyway: selection is newest first.
 *  - A date. Bright Data documents that Instagram no longer exposes a Reel's
 *    publish date to its scraper (August 2026), so `date_posted` is often
 *    null. The grid's `datetime` is the fallback. After that the Reel is kept
 *    undated and ordered by list position (`undatedOrderTrusted`).
 *
 * Field paths are the ones in cc-backend/docs/brightdata-setup.md. A changed
 * wrapper or a renamed field fails closed. The adapter never guesses from a
 * loosely matching field.
 */

const SHORTCODE_IN_URL = /instagram\.com\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i;

/** The grid lists every post as `/p/<shortcode>`, Reels included. */
export const shortcodeFromUrl = (url: string | null | undefined): string | null =>
  (typeof url === 'string' && SHORTCODE_IN_URL.exec(url)?.[1]) || null;

const postSchema = z
  .object({
    shortcode: text,
    url: text,
    user_posted: text,
    /** Often null since August 2026. See the header. */
    date_posted: text,
    likes: counter,
    num_comments: counter,
    /**
     * Two different view numbers, as on every Instagram source.
     * `video_play_count` is what Instagram shows under a Reel as "views";
     * `views` is the older, smaller metric. Bright Data's own example: 1693 vs
     * 4080. The same split on the previous provider measured 1576 vs 4909 on 2026-09-07.
     * Prefer plays, fall back to the legacy field.
     */
    views: counter,
    video_play_count: counter,
    /**
     * NOT a paid-partnership flag, despite the name. Measured 2026-09-30 on
     * 40 Reels: it is true exactly when `coauthor_producers` is non-empty, i.e.
     * a collab. The previous provider's `paidPartnership` was false on every one
     * of those Reels, and dropping them moved the rate (sooyaaa__ 7.58% vs
     * 7.54%). Read for the record only; never used as a flag.
     */
    is_paid_partnership: flag,
    /**
     * Co-author handles. Non-empty means the Reel is a collab. The owner is
     * not listed, so a collab posted by the creator lists the other account,
     * and one posted by the other account lists the creator. Measured on
     * sooyaaa__ 2026-09-30: `["pokemon"]`, `["zayn"]`, `["sooyaaa__"]`.
     */
    coauthor_producers: z.unknown().optional(),
    /**
     * Paid-partnership label details. Present (empty) on some accounts. A
     * non-empty value is the only sponsorship signal read. Not yet seen filled.
     */
    partnership_details: z.unknown().optional(),
    /** The owner's follower count, repeated on every Reel. */
    followers: profileCount,
    product_type: text,
    /**
     * Cover image. Field name not yet certified: Bright Data's Reels examples
     * omit it, so the likely names are all read. The link expires 24 hours
     * after collection; the service copies selected thumbnails to our bucket.
     */
    thumbnail: imageUrl.optional(),
    image_url: imageUrl.optional(),
    display_url: imageUrl.optional(),
    /** Public caption. Absence does not fail the post. */
    description: text,
  })
  .refine((post) => !!(post.shortcode || shortcodeFromUrl(post.url)), { message: 'no shortcode' });

type ReelItem = z.infer<typeof postSchema>;

/** True for a non-empty co-author list, false for an empty one, null when absent. */
const collabOf = (value: unknown): boolean | null => (Array.isArray(value) ? value.length > 0 : null);

/** True for a non-empty object, array or string. */
const hasPartnershipDetails = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as object).length > 0;
  if (typeof value === 'string') return value.trim().length > 0;
  return value === true;
};

const gridPostSchema = z.object({
  url: text,
  datetime: text,
  is_pinned: flag,
});

const profileSchema = z.object({
  account: z.string().min(1),
  full_name: text,
  biography: text,
  followers: profileCount,
  is_private: flag,
  profile_image_link: imageUrl.optional(),
  posts: z.array(z.unknown()).nullish(),
});

type ProfileRead = { ok: true; profile: z.infer<typeof profileSchema> } | { ok: false; failure: AdapterResult | null };

/** Read the profile job, when it produced a row for this handle. */
function readProfileJob(profileItems: unknown, expected: string): ProfileRead {
  const items = asArray(profileItems);
  const match = items
    .map((item) => profileSchema.safeParse(item))
    .find((r) => r.success && normalizeHandle(r.data.account) === expected);
  if (match?.success) return { ok: true, profile: match.data };

  // No profile row. An error row can still say why: private, or not found.
  return { ok: false, failure: errorRowFailure(items) };
}

/** Grid posts by shortcode, for the pinned flag and the fallback date. */
function indexGrid(profile: ProfileRead): Map<string, z.infer<typeof gridPostSchema>> {
  const grid = new Map<string, z.infer<typeof gridPostSchema>>();
  if (!profile.ok) return grid;
  for (const raw of profile.profile.posts ?? []) {
    const parsed = gridPostSchema.safeParse(raw);
    const code = parsed.success ? shortcodeFromUrl(parsed.data.url) : null;
    if (parsed.success && code) grid.set(code, parsed.data);
  }
  return grid;
}

export function parseInstagramOutput(input: AdapterInput): AdapterResult {
  const runError = runFailure(input);
  if (runError) return runError;

  const expected = normalizeHandle(input.expectedUsername);
  const profileJob = readProfileJob(input.profileItems, expected);

  // A private account is only knowable from the profile job. The Reels
  // discovery simply finds nothing for one.
  if (profileJob.ok && profileJob.profile.is_private === true) {
    return fail('PRIVATE_PROFILE', 'This Instagram account is private.');
  }
  if (!profileJob.ok && profileJob.failure && !profileJob.failure.ok && profileJob.failure.code === 'PRIVATE_PROFILE') {
    return profileJob.failure;
  }

  const items = asArray(input.items);
  // The list index is kept: it is the only order an undated Reel has.
  const parsed: { index: number; post: ReelItem }[] = [];
  items.forEach((item, index) => {
    const result = postSchema.safeParse(item);
    if (result.success) parsed.push({ index, post: result.data });
  });

  if (parsed.length === 0) {
    // A public account with no Reels. The profile job already proved the
    // account exists and is public. Zero candidates lets the policy report
    // INSUFFICIENT_DATA and keeps the follower count.
    if (profileJob.ok && items.every(isErrorRow)) {
      return { ok: true, profile: toProfile(expected, profileJob, null), candidates: [] };
    }

    const errorRow = errorRowFailure(items);
    if (errorRow) return errorRow;
    if (!profileJob.ok && profileJob.failure) return profileJob.failure;

    // Items that are present but unparsable are a schema change; no items at
    // all is a missing profile.
    return items.length === 0
      ? fail('PROFILE_NOT_FOUND', `The provider returned no Reels for ${expected}.`)
      : fail('PROVIDER_SCHEMA_CHANGED', 'The Instagram Reels output carried no item with a `shortcode`.');
  }

  const grid = indexGrid(profileJob);
  const isPublic = profileJob.ok && profileJob.profile.is_private === false ? true : null;

  const candidates: PostCandidate[] = parsed.map(({ index, post }): PostCandidate => {
    const shortcode = post.shortcode ?? shortcodeFromUrl(post.url);
    const fromGrid = shortcode ? grid.get(shortcode) : undefined;
    return {
      platform: 'instagram',
      postId: shortcode,
      postUrl: post.url,
      thumbnailUrl: post.thumbnail ?? post.image_url ?? post.display_url ?? null,
      ownerHandle: post.user_posted,
      // Hybrid fallback: the Reel's own date, then the grid's date for the same
      // shortcode, then none. The policy keeps an undated Reel on list order.
      publishedAt: post.date_posted ?? fromGrid?.datetime ?? null,
      likes: post.likes,
      comments: post.num_comments,
      // No Instagram source reports shares, and saves are a private Insights
      // metric that no public source can supply.
      shares: null,
      saves: null,
      // `??` and not `||`, so a genuine zero is never replaced by the legacy
      // number. A photo has neither and the policy drops it.
      views: post.video_play_count ?? post.views,
      // Only a Reel inside the twelve-post grid can be checked. Null elsewhere,
      // which the policy records as unverified rather than assuming false.
      isPinned: fromGrid?.is_pinned ?? null,
      // See `is_paid_partnership` above: it marks collabs, not sponsorship.
      // Only filled `partnership_details` marks a paid partnership; otherwise
      // the flag is unverified, never assumed false.
      isAd: hasPartnershipDetails(post.partnership_details) ? true : null,
      isSponsored: hasPartnershipDetails(post.partnership_details) ? true : null,
      // No repost marker is reported. The owner check catches a collab posted
      // by another account; the policy records this as unverified.
      isRepost: null,
      // Any co-author makes it a collab, and a collab never counts (product
      // decision 2026-09-30). A collab posted by the other account is already
      // dropped as OWNER_MISMATCH, which the policy checks first.
      isCollab: collabOf(post.coauthor_producers),
      isPublic,
      postType: post.product_type,
      caption: post.description,
      sourceRank: index,
      undatedOrderTrusted: true,
    };
  });

  // Every Reel repeats the owner's follower count. It stands in when the
  // profile job failed.
  const fromPosts = parsed.find(({ post }) => normalizeHandle(post.user_posted ?? '') === expected)?.post;

  return { ok: true, profile: toProfile(expected, profileJob, fromPosts?.followers ?? null), candidates };
}

function toProfile(expected: string, profileJob: ProfileRead, fallbackFollowers: number | null): ExtractedProfile {
  return {
    platform: 'instagram',
    username: expected,
    biography: profileJob.ok ? profileJob.profile.biography : null,
    displayName: profileJob.ok ? profileJob.profile.full_name : null,
    profilePictureUrl: (profileJob.ok ? profileJob.profile.profile_image_link : null) ?? null,
    // Null when neither job reported it. v2 does not divide by followers, so a
    // rate is still produced; the admin sees an empty Follower Count field.
    followerCount: (profileJob.ok ? profileJob.profile.followers : null) ?? fallbackFollowers,
    isPrivate: false,
  };
}

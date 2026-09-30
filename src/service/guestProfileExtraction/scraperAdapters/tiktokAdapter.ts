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
 * Adapter for Bright Data's TikTok datasets, across two jobs.
 *
 * The "Posts by Profile Fast API" (`gd_m7n5v2gq296pex2f5m`) supplies one item
 * per video with flat counters. It carries no follower count and no private
 * flag, so the Profiles dataset (`gd_l1villgoiiidt09ci`) supplies those.
 *
 * Unlike the previous provider's TikTok actor, no item carries a pinned, ad, or sponsored
 * flag. All three are recorded unverified. A pinned video is usually old, and
 * the policy's newest-first sort pushes it out of a ten-post sample.
 *
 * Field paths are the ones in cc-backend/docs/brightdata-setup.md. A changed
 * wrapper or a renamed field fails closed.
 */

const HANDLE_IN_URL = /tiktok\.com\/@([^/?#]+)/i;

const handleFromUrl = (url: string | null): string | null => (url && HANDLE_IN_URL.exec(url)?.[1]) || null;

/** An ID that may arrive as a number. Large IDs would lose precision, so strings are preferred. */
const postId = z.union([z.string().min(1), z.number().int().nonnegative().transform(String)]);

const postSchema = z.object({
  post_id: postId,
  url: text,
  /**
   * The handle, without the `@`. This is what the owner check compares.
   * Measured on @jisoo 2026-09-30: `account_id: "jisoo"`.
   */
  account_id: text,
  /**
   * The DISPLAY NAME, despite the field name: `"JISOO"` for handle `jisoo`,
   * and it would be `"Esports World Cup"` for `@ewc_en`. Never used for the
   * owner check; a creator can change it at any time and it is not unique.
   */
  profile_username: text,
  create_time: text,
  /**
   * Likes. Present in the endpoints-page example, absent from the published
   * schema. A missing value is dropped as MISSING_COUNTER, never read as 0.
   */
  digg_count: counter,
  comment_count: counter,
  /**
   * A string (`"344"`) in one documented example; `counter` reads both.
   * Bright Data omits the field when a video has no shares (measured on
   * @ewc_en 2026-09-30: a 3-hour-old video with 8,844 views had none). Read
   * as 0 below, by product decision: no share count means no shares.
   */
  share_count: counter,
  /** Saves. What makes the TikTok numerator the full likes+comments+saves+shares. */
  collect_count: counter,
  play_count: counter,
  /**
   * Cover image. Field name not yet certified: Bright Data's Fast API examples
   * omit it, so the likely names are all read.
   */
  preview_image: imageUrl.optional(),
  cover_image: imageUrl.optional(),
  thumbnail: imageUrl.optional(),
  /** Public caption. Absence does not fail the post. */
  description: text,
});

type PostItem = z.infer<typeof postSchema>;

const profileSchema = z.object({
  /** The handle, without the leading `@`. */
  account_id: z.string().min(1),
  nickname: text,
  /** The bio. `signature` is TikTok's own name for it. */
  biography: text,
  signature: text,
  followers: profileCount,
  is_private: flag,
  profile_pic_url_hd: imageUrl.optional(),
  profile_pic_url: imageUrl.optional(),
});

export function parseTiktokOutput(input: AdapterInput): AdapterResult {
  const runError = runFailure(input);
  if (runError) return runError;

  const expected = normalizeHandle(input.expectedUsername);
  const profileItems = asArray(input.profileItems);
  const owner = profileItems
    .map((item) => profileSchema.safeParse(item))
    .find((r) => r.success && normalizeHandle(r.data.account_id) === expected);
  const profile = owner?.success ? owner.data : null;

  if (profile?.is_private === true) {
    return fail('PRIVATE_PROFILE', 'This TikTok account is private.');
  }
  const profileError = profile ? null : errorRowFailure(profileItems);
  if (profileError && !profileError.ok && profileError.code === 'PRIVATE_PROFILE') return profileError;

  const items = asArray(input.items);
  const parsed: { index: number; post: PostItem }[] = [];
  items.forEach((item, index) => {
    const result = postSchema.safeParse(item);
    if (result.success) parsed.push({ index, post: result.data });
  });

  if (parsed.length === 0) {
    // A public account with no videos. Zero candidates lets the policy report
    // INSUFFICIENT_DATA and keeps the follower count.
    if (profile && items.every(isErrorRow)) {
      return { ok: true, profile: toProfile(expected, profile), candidates: [] };
    }

    const errorRow = errorRowFailure(items);
    if (errorRow) return errorRow;
    if (profileError) return profileError;

    return items.length === 0
      ? fail('PROFILE_NOT_FOUND', `The provider returned no videos for ${expected}.`)
      : fail('PROVIDER_SCHEMA_CHANGED', 'The TikTok posts output carried no item with a `post_id`.');
  }

  const isPublic = profile?.is_private === false ? true : null;

  const candidates: PostCandidate[] = parsed.map(
    ({ index, post }): PostCandidate => ({
      platform: 'tiktok',
      postId: post.post_id,
      postUrl: post.url,
      thumbnailUrl: post.preview_image ?? post.cover_image ?? post.thumbnail ?? null,
      // The handle, never the display name. The URL handle stands in when
      // `account_id` is missing.
      ownerHandle: post.account_id ?? handleFromUrl(post.url),
      publishedAt: post.create_time,
      likes: post.digg_count,
      comments: post.comment_count,
      // The one counter where absent means zero. See `share_count` above.
      shares: post.share_count ?? 0,
      saves: post.collect_count,
      views: post.play_count,
      // Not reported by this dataset. The policy records all four unverified.
      isPinned: null,
      isAd: null,
      isSponsored: null,
      isRepost: null,
      // No co-author field in this dataset. Recorded unverified.
      isCollab: null,
      isPublic,
      postType: 'Video',
      caption: post.description,
      sourceRank: index,
      // Every TikTok item has `create_time`. An undated one is dropped, not
      // ordered by position.
      undatedOrderTrusted: false,
    }),
  );

  return { ok: true, profile: toProfile(expected, profile), candidates };
}

function toProfile(expected: string, profile: z.infer<typeof profileSchema> | null): ExtractedProfile {
  return {
    platform: 'tiktok',
    username: expected,
    biography: profile?.biography ?? profile?.signature ?? null,
    displayName: profile?.nickname ?? null,
    profilePictureUrl: profile?.profile_pic_url_hd ?? profile?.profile_pic_url ?? null,
    // Null when the profile job failed. v2 does not divide by followers.
    followerCount: profile?.followers ?? null,
    isPrivate: false,
  };
}

import { z } from 'zod';

import type { AdapterInput, AdapterResult, ExtractedProfile, PostCandidate } from '@/src/types/guestProfileExtraction';
import { asArray, counter, errorItemFailure, fail, flag, normalizeHandle, runFailure, text } from './adapterShared';

/**
 * Adapter for `clockworks/tiktok-profile-scraper`.
 *
 * One run supplies everything. Every dataset item is a post carrying its own
 * counters at the top level, plus an `authorMeta` block with the handle,
 * display name and follower count. There is no second profile run, and no mode
 * to choose, unlike the Instagram actor.
 *
 * Field paths are the ones recorded in the certification record, measured
 * 2026-09-08 against `@jisoo` on build `0.0.473`: 25 of 25 items carried every
 * field below. A changed wrapper or a renamed field fails closed.
 */

const authorSchema = z.object({
  /** The handle, without the leading `@`. */
  name: text,
  nickName: text,
  /** Follower count. Named `fans` by the actor. */
  fans: counter,
  privateAccount: flag,
});

const postSchema = z.object({
  id: z.string().min(1),
  webVideoUrl: text,
  createTimeISO: text,
  /**
   * Counters, flat and top level. `collectCount` is saves — measured present
   * on 25/25 items, which is what makes the TikTok numerator the full
   * likes + comments + saves + shares.
   */
  diggCount: counter,
  commentCount: counter,
  shareCount: counter,
  playCount: counter,
  collectCount: counter,
  /**
   * All three are real booleans on every item. Instagram reports only
   * `paidPartnership` and no pinned marker at all outside reels mode, so this
   * actor is strictly better informed.
   */
  isPinned: flag,
  isAd: flag,
  isSponsored: flag,
  isSlideshow: flag,
  authorMeta: authorSchema,
  /** Public caption. Absence does not fail the post. */
  text: text,
});

export function parseTiktokActorOutput(input: AdapterInput): AdapterResult {
  const runError = runFailure(input);
  if (runError) return runError;

  const expected = normalizeHandle(input.expectedUsername);
  const items = asArray(input.items);

  const errorItem = errorItemFailure(items);
  if (errorItem) return errorItem;

  /**
   * An empty run is not a schema change.
   *
   * The actor exits 0 having pushed nothing when TikTok serves the profile
   * shell without its video list. Saying the shape moved sends the reader
   * after the wrong thing entirely.
   */
  if (items.length === 0) {
    return fail('PROFILE_NOT_FOUND', `The provider returned no posts for ${expected}.`);
  }

  const parsed = items.map((item) => postSchema.safeParse(item)).filter((r) => r.success);
  if (parsed.length === 0) {
    return fail('PROVIDER_SCHEMA_CHANGED', 'The TikTok actor returned no item carrying `id` and `authorMeta`.');
  }

  // The author block repeats on every item. Prefer the one whose handle matches
  // what was asked for, so a stray item cannot rename the creator.
  const owner = parsed.find((r) => normalizeHandle(r.data.authorMeta.name ?? '') === expected)?.data.authorMeta;

  if (owner?.privateAccount === true) {
    return fail('PRIVATE_PROFILE', 'This TikTok account is private.');
  }

  const candidates: PostCandidate[] = parsed.map((r): PostCandidate => {
    const post = r.data;
    return {
      platform: 'tiktok',
      postId: post.id,
      postUrl: post.webVideoUrl,
      ownerHandle: post.authorMeta.name,
      publishedAt: post.createTimeISO,
      likes: post.diggCount,
      comments: post.commentCount,
      shares: post.shareCount,
      // Saves. Present on this actor, unlike every Instagram source.
      saves: post.collectCount,
      views: post.playCount,
      isPinned: post.isPinned,
      isAd: post.isAd,
      isSponsored: post.isSponsored,
      /**
       * Not reported. `repostCount` counts how often *others* reposted this
       * video, which says nothing about whether this post is itself a repost.
       * A repost of someone else's video carries their handle in `authorMeta`,
       * so the owner check catches it; the policy still records this as
       * unverified rather than assuming false.
       */
      isRepost: null,
      isPublic: post.authorMeta.privateAccount === null ? null : !post.authorMeta.privateAccount,
      postType: post.isSlideshow === true ? 'Slideshow' : 'Video',
      caption: post.text,
    };
  });

  const profile: ExtractedProfile = {
    platform: 'tiktok',
    username: expected,
    displayName: owner?.nickName ?? null,
    followerCount: owner?.fans ?? null,
    isPrivate: false,
  };

  return { ok: true, profile, candidates };
}

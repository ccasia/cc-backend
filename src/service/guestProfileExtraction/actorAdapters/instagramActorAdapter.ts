import { z } from 'zod';

import type { AdapterInput, AdapterResult, ExtractedProfile, PostCandidate } from '@/src/types/guestProfileExtraction';
import { asArray, counter, errorItemFailure, fail, flag, normalizeHandle, runFailure, text } from './adapterShared';

/**
 * Adapter for `apify/instagram-scraper`, across two runs.
 *
 * `reels` mode supplies the post metrics as top-level dataset items. `details`
 * mode supplies the follower count and the private flag. The split exists
 * because `details` caps its nested `latestPosts` at twelve whatever
 * `resultsLimit` says, and the formula needs ten posts that carry views.
 *
 * The feed run is `reels` rather than `posts`, so every item carries a view
 * count. `reels` also reports `isPinned`, which `posts` mode never did.
 *
 * Field paths are the ones recorded in the certification record. A changed
 * wrapper or a renamed field fails closed. The adapter never guesses from a
 * loosely matching field such as `follower_total`.
 */

const postSchema = z.object({
  id: z.string().min(1),
  type: text,
  url: text,
  timestamp: text,
  likesCount: counter,
  commentsCount: counter,
  /**
   * Two different view numbers. `videoPlayCount` is what Instagram shows under
   * a Reel as "views"; `videoViewCount` is the older, much smaller metric and
   * runs about a third of it. Measured on cultcreativeasia 2026-09-07: 1576 vs
   * 4909 on the same Reel. Prefer plays, fall back to the legacy field.
   */
  videoPlayCount: counter,
  videoViewCount: counter,
  ownerUsername: text,
  ownerFullName: text,
  /**
   * Reported by `reels` mode on every item, and by `posts` mode on none. Read
   * as a real flag now, so a pinned post is excluded rather than recorded in
   * `unverifiedFlags`. Stays nullish, so a mode that omits it still parses.
   */
  isPinned: flag,
  /**
   * The only sponsorship signal this actor reports, in both modes. There is no
   * `isSponsored` field; an earlier build of this adapter read one that never
   * existed and recorded every post as unverified.
   */
  paidPartnership: flag,
  productType: text,
  /** Public caption. Optional: absence does not fail the post. */
  caption: text,
});

const profileSchema = z.object({
  username: z.string().min(1),
  fullName: text,
  followersCount: counter,
  private: flag,
  latestPosts: z.array(z.unknown()).nullish(),
});

/** Read the `details` item, when the profile run produced one. */
function readProfileRun(
  profileItems: unknown,
  expected: string,
): { ok: true; profile: z.infer<typeof profileSchema> } | { ok: false; private: boolean } {
  const items = asArray(profileItems);
  if (items.length === 0) return { ok: false, private: false };

  const profiles = items.map((item) => profileSchema.safeParse(item)).filter((r) => r.success);
  const match = profiles.find((r) => normalizeHandle(r.data.username) === expected);
  if (!match) return { ok: false, private: false };

  return { ok: true, profile: match.data };
}

export function parseInstagramActorOutput(input: AdapterInput): AdapterResult {
  const runError = runFailure(input);
  if (runError) return runError;

  const expected = normalizeHandle(input.expectedUsername);
  const profileRun = readProfileRun(input.profileItems, expected);

  // A private account is only knowable from the profile run. The posts run
  // simply returns nothing for one.
  if (profileRun.ok && profileRun.profile.private === true) {
    return fail('PRIVATE_PROFILE', 'This Instagram account is private.');
  }

  const items = asArray(input.items);
  const errorItem = errorItemFailure(items);
  if (errorItem) return errorItem;

  const parsed = items.map((item) => postSchema.safeParse(item)).filter((r) => r.success);

  if (parsed.length === 0) {
    // Nothing parsed. Either the account has no posts this run could read, or
    // the output shape moved. An item that is present but unparsable is a
    // schema change; no items at all is a missing profile.
    return items.length === 0
      ? fail('PROFILE_NOT_FOUND', `The provider returned no posts for ${expected}.`)
      : fail('PROVIDER_SCHEMA_CHANGED', 'The Instagram actor returned no item carrying `id` and `likesCount`.');
  }

  const candidates: PostCandidate[] = parsed.map((r): PostCandidate => {
    const post = r.data;
    return {
      platform: 'instagram',
      postId: post.id,
      postUrl: post.url,
      ownerHandle: post.ownerUsername,
      publishedAt: post.timestamp,
      likes: post.likesCount,
      comments: post.commentsCount,
      // The actor reports no share count, and saves are a private Insights
      // metric that no public source can supply.
      shares: null,
      saves: null,
      // Present on Reels and video posts only. A photo or a carousel has none,
      // and the valid-post policy drops it, because views are the denominator.
      // `??` and not `||`, so a genuine zero is never replaced by the legacy
      // number.
      views: post.videoPlayCount ?? post.videoViewCount,
      // Reported by `reels` mode on 40/40 items, measured 2026-09-07. Null on
      // any mode that omits it, which the policy records as unverified rather
      // than assuming false. See certification.md.
      isPinned: post.isPinned,
      isAd: post.paidPartnership,
      isSponsored: post.paidPartnership,
      // It reports no repost marker. The policy records this as unverified.
      isRepost: null,
      isPublic: null,
      postType: post.type,
      caption: post.caption,
    };
  });

  // The posts run carries the owner's handle and display name on every post.
  // Only the follower count needs the profile run.
  const fromPosts = parsed.find((r) => normalizeHandle(r.data.ownerUsername ?? '') === expected)?.data;

  const profile: ExtractedProfile = {
    platform: 'instagram',
    username: expected,
    displayName: profileRun.ok ? profileRun.profile.fullName : (fromPosts?.ownerFullName ?? null),
    // Null when the profile run failed. v2 does not divide by followers, so a
    // rate is still produced; the admin sees an empty Follower Count field.
    followerCount: profileRun.ok ? profileRun.profile.followersCount : null,
    isPrivate: false,
  };

  return { ok: true, profile, candidates };
}

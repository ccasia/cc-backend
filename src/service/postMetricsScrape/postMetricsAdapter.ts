import { z } from 'zod';

import type { AdapterFailureCode, SupportedPlatform } from '@/src/types/guestProfileExtraction';
import {
  asArray,
  counter,
  errorRowFailure,
  imageUrl,
  text,
} from '@services/guestProfileExtraction/scraperAdapters/adapterShared';
import { shortcodeFromUrl } from '@services/guestProfileExtraction/scraperAdapters/instagramAdapter';

/**
 * Reads one post from a Bright Data collect-by-URL job.
 *
 * Provider output enters as `unknown`. A missing or unreadable counter fails
 * closed; it is never read as 0, except where a product decision says so:
 *  - Instagram shares and saves are private Insights metrics. No public source
 *    has them, so they are stored as 0 and the rate leaves them out.
 *  - Instagram photos have no view count. Views are 0 and the rate is 0.
 *  - TikTok omits `share_count` when a video has none (see tiktokAdapter.ts).
 *
 * An Instagram Reel's views are not in the collect-by-URL output. The result
 * then names the owner and shortcode, and `findReelViews` reads the views
 * from a Reels discovery of that owner.
 */

export interface PostMetrics {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saved: number;
}

export interface ReelLookup {
  owner: string;
  shortcode: string;
}

export type PostMetricsResult =
  | { ok: true; metrics: PostMetrics; item: Record<string, unknown>; reelLookup: ReelLookup | null }
  | { ok: false; code: AdapterFailureCode; message: string };

const instagramPostSchema = z.object({
  shortcode: text,
  url: text,
  user_posted: text,
  content_type: text,
  product_type: text,
  likes: counter,
  num_comments: counter,
  video_play_count: counter,
  video_view_count: counter,
  views: counter,
});

const reelSchema = z.object({
  shortcode: text,
  url: text,
  likes: counter,
  num_comments: counter,
  /** What Instagram shows as "views" on a Reel. See instagramAdapter.ts. */
  video_play_count: counter,
  views: counter,
});

const tiktokPostSchema = z.object({
  play_count: counter,
  digg_count: counter,
  comment_count: counter,
  share_count: counter,
});

const isCount = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const fail = (code: AdapterFailureCode, message: string): PostMetricsResult => ({ ok: false, code, message });

type Read = { metrics: PostMetrics; reelLookup: ReelLookup | null } | { failure: PostMetricsResult } | null;

function readInstagram(item: unknown): Read {
  const parsed = instagramPostSchema.safeParse(item);
  if (!parsed.success) return null;
  const post = parsed.data;
  if (!isCount(post.likes) || !isCount(post.num_comments)) return null;

  const counts = { likes: post.likes, comments: post.num_comments, shares: 0, saved: 0 };
  const views = post.video_play_count ?? post.video_view_count ?? post.views;
  if (isCount(views)) return { metrics: { views, ...counts }, reelLookup: null };

  const isReel = post.product_type === 'clips' || /reel|video|clip/i.test(post.content_type ?? '');
  if (!isReel) return { metrics: { views: 0, ...counts }, reelLookup: null };

  const shortcode = post.shortcode ?? shortcodeFromUrl(post.url);
  if (!post.user_posted || !shortcode) {
    return { failure: fail('PROVIDER_SCHEMA_CHANGED', 'The Instagram Reel carried no owner or shortcode.') };
  }
  return { metrics: { views: 0, ...counts }, reelLookup: { owner: post.user_posted, shortcode } };
}

function readTiktok(item: unknown): Read {
  const parsed = tiktokPostSchema.safeParse(item);
  if (!parsed.success) return null;
  const post = parsed.data;
  const shares = post.share_count ?? 0;
  if (![post.play_count, post.digg_count, post.comment_count, shares].every(isCount)) return null;
  return {
    metrics: {
      views: post.play_count as number,
      likes: post.digg_count as number,
      comments: post.comment_count as number,
      shares,
      saved: 0,
    },
    reelLookup: null,
  };
}

export function parsePostMetrics(platform: SupportedPlatform, items: unknown): PostMetricsResult {
  const rows = asArray(items);
  const read = platform === 'instagram' ? readInstagram : readTiktok;

  for (const item of rows) {
    const result = read(item);
    if (result && 'failure' in result) return result.failure;
    if (result) return { ok: true, ...result, item: item as Record<string, unknown> };
  }

  const errorRow = errorRowFailure(rows);
  if (errorRow && !errorRow.ok) return fail(errorRow.code, errorRow.message);

  return rows.length === 0
    ? fail('PROFILE_NOT_FOUND', 'The provider returned no item for this post.')
    : fail('PROVIDER_SCHEMA_CHANGED', `The ${platform} post output carried no readable counters.`);
}

/** Reads one Reel's counters from a Reels discovery of its owner. Null when the Reel is absent or has no views. */
export function findReelViews(items: unknown, shortcode: string): Omit<PostMetrics, 'shares' | 'saved'> | null {
  for (const item of asArray(items)) {
    const parsed = reelSchema.safeParse(item);
    if (!parsed.success) continue;
    const reel = parsed.data;
    if ((reel.shortcode ?? shortcodeFromUrl(reel.url)) !== shortcode) continue;

    const views = reel.video_play_count ?? reel.views;
    if (!isCount(views) || !isCount(reel.likes) || !isCount(reel.num_comments)) return null;
    return { views, likes: reel.likes, comments: reel.num_comments };
  }
  return null;
}

/** Engagement over views. Scraped Instagram rows carry 0 shares and saves, so they add nothing. */
export function scrapedEngagementRate(metrics: PostMetrics): number {
  if (metrics.views <= 0) return 0;
  return ((metrics.likes + metrics.comments + metrics.shares + metrics.saved) / metrics.views) * 100;
}

const thumbnailSchema = z.object({
  thumbnail: imageUrl.optional(),
  image_url: imageUrl.optional(),
  display_url: imageUrl.optional(),
  preview_image: imageUrl.optional(),
  cover_image: imageUrl.optional(),
});

/** The provider's thumbnail for one scraped post, or null. The URL expires, so the caller copies it. */
export function postThumbnail(platform: SupportedPlatform, item: unknown): string | null {
  const parsed = thumbnailSchema.safeParse(item);
  if (!parsed.success) return null;
  const t = parsed.data;
  return platform === 'tiktok'
    ? (t.preview_image ?? t.cover_image ?? t.thumbnail ?? null)
    : (t.thumbnail ?? t.image_url ?? t.display_url ?? null);
}

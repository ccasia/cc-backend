import { getInstagramMedias, getMediaInsight } from '@services/socialMediaService';
import {
  getCampaignSubmissionUrls,
  ensureValidInstagramToken,
  extractInstagramShortcode,
} from '@controllers/socialController';
import { prisma } from '../prisma/prisma';
import { ExternalMetrics } from '../types/index';

interface PostInsight {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  reach: number;
  impressions: number;
}

function parseInsight(metrics: { name: string; value: number }[]): PostInsight {
  const map = Object.fromEntries(metrics.map((m) => [m.name, m.value ?? 0]));
  return {
    views: map['views'] ?? 0,
    likes: map['likes'] ?? 0,
    comments: map['comments'] ?? 0,
    shares: map['shares'] ?? 0,
    reach: map['reach'] ?? 0,
    impressions: map['impressions'] ?? 0,
  };
}

export async function fetchInstagramCampaignMetrics(campaignId: string): Promise<ExternalMetrics> {
  // Fetch live API data and manual entries in parallel
  const [allUrls, manualEntries] = await Promise.all([
    getCampaignSubmissionUrls(campaignId),
    prisma.manualCreatorEntry.findMany({
      where: { campaignId, platform: 'Instagram' },
    }),
  ]);

  const instagramUrls = allUrls.filter((u) => u.platform === 'Instagram');

  // ── 1. Live API metrics ───────────────────────────────────────────────────────

  const urlsByUser = new Map<string, typeof instagramUrls>();
  for (const urlData of instagramUrls) {
    if (!urlsByUser.has(urlData.userId)) urlsByUser.set(urlData.userId, []);
    urlsByUser.get(urlData.userId)!.push(urlData);
  }

  const apiCreatorResults: {
    userId: string;
    followers: number;
    posts: PostInsight[];
  }[] = [];

  for (const [userId, urls] of urlsByUser) {
    try {
      const [accessToken, creator] = await Promise.all([
        ensureValidInstagramToken(userId),
        prisma.creator.findFirst({
          where: { userId },
          select: { instagramUser: { select: { media_count: true, followers_count: true } } },
        }),
      ]);

      const mediaCount = creator?.instagramUser?.media_count ?? 50;
      const followers = creator?.instagramUser?.followers_count ?? 0;
      const { videos } = await getInstagramMedias(accessToken, mediaCount);
      const posts: PostInsight[] = [];

      for (const urlData of urls) {
        const shortCode = extractInstagramShortcode(urlData.url);
        if (!shortCode) continue;

        const video = videos.find((v: any) => v.shortcode === shortCode);
        if (!video) continue;

        try {
          const raw = await getMediaInsight(accessToken, video.id);
          if (raw && raw.length > 0) posts.push(parseInsight(raw));
        } catch (err) {
          console.error(`[InstagramInsightCollector] Failed to fetch insight for ${urlData.url}:`, err);
        }
      }

      apiCreatorResults.push({ userId, followers, posts });
    } catch (err) {
      // Token expired or not connected — skip, snapshot fallback applies
      console.warn(`[InstagramInsightCollector] Skipping creator ${userId}:`, (err as Error).message);
    }
  }

  // ── 2. Aggregate API totals ───────────────────────────────────────────────────

  let apiViews = 0,
    apiLikes = 0,
    apiComments = 0,
    apiShares = 0,
    apiReach = 0,
    apiImpressions = 0;

  const creatorMetrics: NonNullable<ExternalMetrics['engagement']>['creatorMetrics'] = [];
  const creatorPersonas: NonNullable<ExternalMetrics['creators']> = [];

  for (const creator of apiCreatorResults) {
    let cViews = 0,
      cLikes = 0,
      cComments = 0,
      cShares = 0;

    for (const post of creator.posts) {
      apiViews += post.views;
      apiLikes += post.likes;
      apiComments += post.comments;
      apiShares += post.shares;
      apiReach += post.reach;
      apiImpressions += post.impressions;
      cViews += post.views;
      cLikes += post.likes;
      cComments += post.comments;
      cShares += post.shares;
    }

    const cEngagements = cLikes + cComments + cShares;
    const cEngRate = creator.followers > 0 ? +((cEngagements / creator.followers) * 100).toFixed(2) : 0;

    creatorMetrics.push({
      userId: creator.userId,
      platform: 'Instagram',
      engagementRate: cEngRate,
      followers: creator.followers,
      views: cViews,
      likes: cLikes,
      comments: cComments,
    });

    creatorPersonas.push({
      userId: creator.userId,
      totalViews: cViews,
      totalLikes: cLikes,
      totalComments: cComments,
      engagementRate: cEngRate,
      followers: creator.followers,
    });
  }

  // ── 3. Aggregate manual entry totals ─────────────────────────────────────────

  let manualViews = 0,
    manualLikes = 0,
    manualComments = 0,
    manualShares = 0;

  for (const entry of manualEntries) {
    manualViews += entry.views;
    manualLikes += entry.likes;
    manualComments += entry.comments;
    manualShares += entry.shares;
  }

  // ── 4. Combine both sources ───────────────────────────────────────────────────

  const totalViews = apiViews + manualViews;
  const totalLikes = apiLikes + manualLikes;
  const totalComments = apiComments + manualComments;
  const totalShares = apiShares + manualShares;
  const totalEngagements = totalLikes + totalComments + totalShares;

  const totalFollowers = apiCreatorResults.reduce((s, c) => s + c.followers, 0);
  const engagementRate = totalFollowers > 0 ? +((totalEngagements / totalFollowers) * 100).toFixed(2) : 0;

  const totalPosts = instagramUrls.length + manualEntries.length;

  if (totalViews === 0 && totalEngagements === 0) return {};

  return {
    summary: {
      totalViews,
      totalEngagements,
      engagementRate,
      reach: apiReach,
      impressions: apiImpressions,
      totalShares,
      totalComments,
      totalLikes,
    },
    engagement: {
      totalEngagement: totalEngagements,
      platformBreakdown: [{ platform: 'Instagram', posts: totalPosts, engagement: totalEngagements }],
      creatorMetrics,
    },
    views: {
      totalViews,
    },
    creators: creatorPersonas,
  };
}

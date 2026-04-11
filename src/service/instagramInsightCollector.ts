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
  const allUrls = await getCampaignSubmissionUrls(campaignId);
  const instagramUrls = allUrls.filter((u) => u.platform === 'Instagram');

  if (instagramUrls.length === 0) return {};

  // Group URLs by creator
  const urlsByUser = new Map<string, typeof instagramUrls>();
  for (const urlData of instagramUrls) {
    if (!urlsByUser.has(urlData.userId)) urlsByUser.set(urlData.userId, []);
    urlsByUser.get(urlData.userId)!.push(urlData);
  }

  // Fetch insights per creator
  const creatorResults: {
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

      creatorResults.push({ userId, followers, posts });
    } catch (err) {
      // Creator token expired or not connected — skip, snapshot fallback applies
      console.warn(`[InstagramInsightCollector] Skipping creator ${userId}:`, (err as Error).message);
    }
  }

  if (creatorResults.length === 0) return {};

  // Aggregate totals
  let totalViews = 0,
    totalLikes = 0,
    totalComments = 0,
    totalShares = 0,
    totalReach = 0,
    totalImpressions = 0;

  const creatorMetrics: NonNullable<ExternalMetrics['engagement']>['creatorMetrics'] = [];
  const creatorPersonas: NonNullable<ExternalMetrics['creators']> = [];

  for (const creator of creatorResults) {
    let cViews = 0,
      cLikes = 0,
      cComments = 0,
      cShares = 0;

    for (const post of creator.posts) {
      totalViews += post.views;
      totalLikes += post.likes;
      totalComments += post.comments;
      totalShares += post.shares;
      totalReach += post.reach;
      totalImpressions += post.impressions;
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

  const totalEngagements = totalLikes + totalComments + totalShares;
  const totalFollowers = creatorResults.reduce((s, c) => s + c.followers, 0);
  const engagementRate = totalFollowers > 0 ? +((totalEngagements / totalFollowers) * 100).toFixed(2) : 0;

  return {
    summary: {
      totalViews,
      totalEngagements,
      engagementRate,
      reach: totalReach,
      impressions: totalImpressions,
    },
    engagement: {
      totalEngagement: totalEngagements,
      platformBreakdown: [{ platform: 'Instagram', posts: instagramUrls.length, engagement: totalEngagements }],
      creatorMetrics,
    },
    views: {
      totalViews,
    },
    creators: creatorPersonas,
  };
}

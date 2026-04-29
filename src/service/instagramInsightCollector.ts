import { getInstagramMedias, getMediaInsight, getTikTokVideoById } from '@services/socialMediaService';
import {
  getCampaignSubmissionUrls,
  ensureValidInstagramToken,
  ensureValidTikTokToken,
  extractInstagramShortcode,
  extractTikTokVideoId,
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
  saves: number;
}

function parseInstagramInsight(metrics: { name: string; value: number }[]): PostInsight {
  const map = Object.fromEntries(metrics.map((m) => [m.name, m.value ?? 0]));
  return {
    views: map['views'] ?? 0,
    likes: map['likes'] ?? 0,
    comments: map['comments'] ?? 0,
    shares: map['shares'] ?? 0,
    reach: map['reach'] ?? 0,
    impressions: map['impressions'] ?? 0,
    saves: map['saved'] ?? 0,
  };
}

function parseTikTokVideo(video: any): PostInsight {
  return {
    views: video.view_count ?? 0,
    likes: video.like_count ?? 0,
    comments: video.comment_count ?? 0,
    shares: video.share_count ?? 0,
    reach: 0,
    impressions: 0,
    saves: 0,
  };
}

// ── Instagram ─────────────────────────────────────────────────────────────────

async function fetchInstagramMetrics(urlsByUser: Map<string, { url: string; userId: string }[]>) {
  const results: { userId: string; followers: number; posts: PostInsight[]; totalSaved: number }[] = [];

  for (const [userId, urls] of urlsByUser) {
    try {
      const [accessToken, creator] = await Promise.all([
        ensureValidInstagramToken(userId),
        prisma.creator.findFirst({
          where: { userId },
          select: { instagramUser: { select: { media_count: true, followers_count: true, totalSaves: true } } },
        }),
      ]);

      const mediaCount = creator?.instagramUser?.media_count ?? 50;
      const followers = creator?.instagramUser?.followers_count ?? 0;
      const totalSaved = creator?.instagramUser?.totalSaves ?? 0;
      const { videos } = await getInstagramMedias(accessToken, mediaCount);
      const posts: PostInsight[] = [];

      for (const urlData of urls) {
        const shortCode = extractInstagramShortcode(urlData.url);
        if (!shortCode) continue;

        const video = videos.find((v: any) => v.shortcode === shortCode);
        if (!video) continue;

        try {
          const raw = await getMediaInsight(accessToken, video.id);
          if (raw && raw.length > 0) posts.push(parseInstagramInsight(raw));
        } catch (err) {
          console.error(`[InsightCollector] Instagram insight failed for ${urlData.url}:`, err);
        }
      }

      results.push({ userId, followers, posts, totalSaved });
    } catch (err) {
      console.warn(`[InsightCollector] Skipping Instagram creator ${userId}:`, (err as Error).message);
    }
  }

  return results;
}

// ── TikTok ────────────────────────────────────────────────────────────────────

async function fetchTikTokMetrics(urlsByUser: Map<string, { url: string; userId: string }[]>) {
  const results: { userId: string; followers: number; posts: PostInsight[] }[] = [];

  for (const [userId, urls] of urlsByUser) {
    try {
      const [accessToken, creator] = await Promise.all([
        ensureValidTikTokToken(userId),
        prisma.creator.findFirst({
          where: { userId },
          select: { tiktokUser: { select: { follower_count: true } } },
        }),
      ]);

      const followers = creator?.tiktokUser?.follower_count ?? 0;
      const posts: PostInsight[] = [];

      for (const urlData of urls) {
        const videoId = extractTikTokVideoId(urlData.url);

        if (!videoId) continue;

        try {
          const response = await getTikTokVideoById(accessToken, videoId);
          const video = response?.data?.videos?.[0];
          if (video) posts.push(parseTikTokVideo(video));
        } catch (err) {
          console.error(`[InsightCollector] TikTok insight failed for ${urlData.url}:`, err);
        }
      }

      results.push({ userId, followers, posts });
    } catch (err) {
      console.warn(`[InsightCollector] Skipping TikTok creator ${userId}:`, (err as Error).message);
    }
  }

  return results;
}

// ── Aggregator ────────────────────────────────────────────────────────────────

function aggregateCreatorResults(
  results: { userId: string; followers: number; posts: PostInsight[] }[],
  platform: string,
) {
  let totalViews = 0,
    totalLikes = 0,
    totalComments = 0,
    totalShares = 0,
    totalReach = 0,
    totalImpressions = 0,
    totalSaved = 0;

  const creatorMetrics: NonNullable<ExternalMetrics['engagement']>['creatorMetrics'] = [];
  const creatorPersonas: NonNullable<ExternalMetrics['creators']> = [];

  for (const creator of results) {
    let cViews = 0,
      cLikes = 0,
      cComments = 0,
      cShares = 0,
      cSaved = 0;

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
      totalSaved += post.saves;
      cSaved += post.saves;
    }

    const cEngagements = cLikes + cComments + cShares + cSaved;
    const cEngRate = creator.followers > 0 ? +((cEngagements / creator.followers) * 100).toFixed(2) : 0;

    creatorMetrics.push({
      userId: creator.userId,
      platform,
      engagementRate: cEngRate,
      followers: creator.followers,
      views: cViews,
      likes: cLikes,
      saved: cSaved,
      comments: cComments,
    });
    creatorPersonas.push({
      userId: creator.userId,
      totalViews: cViews,
      totalLikes: cLikes,
      totalComments: cComments,
      engagementRate: cEngRate,
      totalSaved: cSaved,
      followers: creator.followers,
    });
  }

  return {
    totalViews,
    totalLikes,
    totalComments,
    totalShares,
    totalReach,
    totalSaved,
    totalImpressions,
    creatorMetrics,
    creatorPersonas,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function fetchInstagramCampaignMetrics(campaignId: string): Promise<ExternalMetrics> {
  const [allUrls, manualEntries] = await Promise.all([
    getCampaignSubmissionUrls(campaignId), // Get all urls – Instagram & Tiktok
    prisma.manualCreatorEntry.findMany({ where: { campaignId } }), // Get all manual entry for insights
  ]);

  // Group URLs by platform then by userId
  const igUrlsByUser = new Map<string, typeof allUrls>();
  const ttUrlsByUser = new Map<string, typeof allUrls>();

  for (const urlData of allUrls) {
    if (urlData.platform === 'Instagram') {
      if (!igUrlsByUser.has(urlData.userId)) igUrlsByUser.set(urlData.userId, []);
      igUrlsByUser.get(urlData.userId)!.push(urlData);
    } else if (urlData.platform === 'TikTok') {
      if (!ttUrlsByUser.has(urlData.userId)) ttUrlsByUser.set(urlData.userId, []);
      ttUrlsByUser.get(urlData.userId)!.push(urlData);
    }
  }

  // Fetch both platforms in parallel
  const [igResults, ttResults] = await Promise.all([
    fetchInstagramMetrics(igUrlsByUser),
    fetchTikTokMetrics(ttUrlsByUser),
  ]);

  console.log(igResults, ttResults);

  const ig = aggregateCreatorResults(igResults, 'Instagram');
  const tt = aggregateCreatorResults(ttResults, 'TikTok');

  // Manual entries by platform
  const manualIg = manualEntries.filter((e) => e.platform === 'Instagram');
  const manualTt = manualEntries.filter((e) => e.platform === 'TikTok');

  const manualSum = (entries: typeof manualEntries) =>
    entries.reduce(
      (acc, e) => ({
        views: acc.views + e.views,
        likes: acc.likes + e.likes,
        comments: acc.comments + e.comments,
        shares: acc.shares + e.shares,
        saved: acc.saved + (e.saved ?? 0),
      }),
      { views: 0, likes: 0, comments: 0, shares: 0, saved: 0 },
    );

  const manualIgTotals = manualSum(manualIg);
  const manualTtTotals = manualSum(manualTt);

  // Latest snapshot totals per platform
  // const snapIgTotals = {
  //   views: snapshotIg?.totalViews ?? 0,
  //   likes: snapshotIg?.totalLikes ?? 0,
  //   comments: snapshotIg?.totalComments ?? 0,
  //   shares: snapshotIg?.totalShares ?? 0,
  //   reach: snapshotIg?.totalReach ?? 0,
  // };

  // const snapTtTotals = {
  //   views: snapshotTt?.totalViews ?? 0,
  //   likes: snapshotTt?.totalLikes ?? 0,
  //   comments: snapshotTt?.totalComments ?? 0,
  //   shares: snapshotTt?.totalShares ?? 0,
  //   reach: snapshotTt?.totalReach ?? 0,
  // };

  // Combined totals: API + Manual + Snapshot
  const totalViews = ig.totalViews + tt.totalViews + manualIgTotals.views + manualTtTotals.views;

  const totalLikes = ig.totalLikes + tt.totalLikes + manualIgTotals.likes + manualTtTotals.likes;

  const totalComments = ig.totalComments + tt.totalComments + manualIgTotals.comments + manualTtTotals.comments;

  const totalShares = ig.totalShares + tt.totalShares + manualIgTotals.shares + manualTtTotals.shares;

  const totalSaved = ig.totalSaved + tt.totalSaved + manualIgTotals.shares + manualTtTotals.shares;

  const totalEngagements = totalLikes + totalComments + totalShares + totalSaved;
  const totalReach = ig.totalReach + tt.totalReach;
  const totalImpressions = ig.totalImpressions + tt.totalImpressions;

  const totalFollowers = [...igResults, ...ttResults].reduce((s, c) => s + c.followers, 0);
  const engagementRate = Math.max(
    +((totalEngagements / totalViews) * 100).toFixed(2),
    // +((totalEngagements / totalFollowers) * 100).toFixed(2),
  );
  // totalFollowers > 0
  //   ? +((totalEngagements / totalFollowers) * 100).toFixed(2)
  //   : +((totalEngagements / totalViews) * 100).toFixed(2);

  if (totalViews === 0 && totalEngagements === 0) return {};

  const igPostCount = allUrls.filter((u) => u.platform === 'Instagram').length + manualIg.length;

  const ttPostCount = allUrls.filter((u) => u.platform === 'TikTok').length + manualTt.length;

  const igEngagements =
    ig.totalLikes +
    ig.totalComments +
    ig.totalShares +
    manualIgTotals.likes +
    manualIgTotals.comments +
    manualIgTotals.shares;

  const ttEngagements =
    tt.totalLikes +
    tt.totalComments +
    tt.totalShares +
    manualTtTotals.likes +
    manualTtTotals.comments +
    manualTtTotals.shares;

  return {
    summary: {
      totalViews,
      totalEngagements,
      engagementRate,
      reach: totalReach,
      impressions: totalImpressions,
      totalLikes,
      totalComments,
      totalShares,
    },
    engagement: {
      totalEngagement: totalEngagements,
      platformBreakdown: [
        { platform: 'Instagram', posts: igPostCount, engagement: igEngagements },
        { platform: 'TikTok', posts: ttPostCount, engagement: ttEngagements },
      ],
      creatorMetrics: [...ig.creatorMetrics, ...tt.creatorMetrics],
    },
    views: { totalViews },
    creators: [...ig.creatorPersonas, ...tt.creatorPersonas],
  };
}

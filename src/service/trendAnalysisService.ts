import { PrismaClient } from '@prisma/client';
import dayjs from 'dayjs';

const prisma = new PrismaClient();

export interface DailyMetrics {
  platform: string;
  totalPosts: number;
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  totalSaved: number; // Instagram only
  totalReach: number; // Instagram only
  averageEngagementRate: number;
  topCreatorsByViews: TopCreator[];
}

export interface TopCreator {
  userId: string;
  userName: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  engagementRate: number;
  postUrl: string;
  postingDate: Date;
}

export interface NormalizedInsight {
  userId: string;
  userName: string;
  postUrl: string;
  postingDate: Date;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saved?: number; // Instagram only
  reach?: number; // Instagram only
}

/**
 * Transform a manual creator entry to NormalizedInsight format
 * @param entry - Manual creator entry from database
 * @returns NormalizedInsight object
 */
export function transformManualEntryToNormalizedInsight(entry: any): NormalizedInsight {
  return {
    userId: entry.id, // Use entry ID as userId for manual entries
    userName: entry.creatorName,
    postUrl: entry.postUrl || '',
    postingDate: entry.createdAt, // Use createdAt as posting date
    views: entry.views,
    likes: entry.likes,
    comments: 0, // Manual entries don't track comments
    shares: entry.shares,
    saved: entry.platform === 'Instagram' ? (entry.saved || 0) : undefined,
    reach: undefined, // Manual entries don't track reach
  };
}

/**
 * Calculate daily metrics from normalized insights data
 * @param campaignId - Campaign ID
 * @param platform - Platform filter ('Instagram', 'TikTok', 'All')
 * @param insights - Array of normalized insights from API
 * @param manualEntries - Optional array of manual creator entries to include
 */
export async function calculateDailyMetrics(
  campaignId: string,
  platform: 'Instagram' | 'TikTok' | 'All',
  insights: NormalizedInsight[],
  manualEntries: any[] = []
): Promise<DailyMetrics> {
  // Transform manual entries to NormalizedInsight format and filter by platform
  const transformedManualEntries: NormalizedInsight[] = manualEntries
    .filter((entry) => {
      if (platform === 'All') return true;
      return entry.platform === platform;
    })
    .map(transformManualEntryToNormalizedInsight);

  // Combine API insights with manual entries
  const allInsights = [...insights, ...transformedManualEntries];

  console.log(`📊 Calculating metrics for ${platform} (${insights.length} API insights + ${transformedManualEntries.length} manual entries = ${allInsights.length} total)...`);

  if (allInsights.length === 0) {
    console.warn(`⚠️  No insights to calculate for ${platform}`);
    return {
      platform,
      totalPosts: 0,
      totalViews: 0,
      totalLikes: 0,
      totalComments: 0,
      totalShares: 0,
      totalSaved: 0,
      totalReach: 0,
      averageEngagementRate: 0,
      topCreatorsByViews: [],
    };
  }

  // Aggregate totals
  const totals = allInsights.reduce(
    (acc, insight) => ({
      views: acc.views + insight.views,
      likes: acc.likes + insight.likes,
      comments: acc.comments + insight.comments,
      shares: acc.shares + insight.shares,
      saved: acc.saved + (insight.saved || 0),
      reach: acc.reach + (insight.reach || 0),
    }),
    { views: 0, likes: 0, comments: 0, shares: 0, saved: 0, reach: 0 }
  );

  // Calculate engagement rate based on platform
  let averageEngagementRate = 0;
  if (platform === 'Instagram') {
    // Instagram: (likes + comments + shares + saved) / reach * 100
    // If no reach data (e.g., manual entries), use views as fallback
    const denominator = totals.reach > 0 ? totals.reach : totals.views;
    if (denominator > 0) {
      averageEngagementRate =
        ((totals.likes + totals.comments + totals.shares + totals.saved) / denominator) * 100;
    }
  } else if (platform === 'TikTok') {
    // TikTok: (likes + comments + shares) / views * 100
    if (totals.views > 0) {
      averageEngagementRate = ((totals.likes + totals.comments + totals.shares) / totals.views) * 100;
    }
  } else {
    // All platforms: Use combined metric
    const denominator = totals.reach > 0 ? totals.reach : totals.views;
    if (denominator > 0) {
      averageEngagementRate =
        ((totals.likes + totals.comments + totals.shares + totals.saved) / denominator) * 100;
    }
  }

  // Calculate top creators by views
  const creatorsWithEngagement = allInsights.map((insight) => {
    let engagementRate = 0;
    if (platform === 'Instagram' && insight.reach && insight.reach > 0) {
      engagementRate =
        ((insight.likes + insight.comments + insight.shares + (insight.saved || 0)) /
          insight.reach) *
        100;
    } else if (insight.views > 0) {
      engagementRate = ((insight.likes + insight.comments + insight.shares) / insight.views) * 100;
    }

    return {
      userId: insight.userId,
      userName: insight.userName,
      views: insight.views,
      likes: insight.likes,
      comments: insight.comments,
      shares: insight.shares,
      engagementRate: parseFloat(engagementRate.toFixed(2)),
      postUrl: insight.postUrl,
      postingDate: insight.postingDate,
    };
  });

  // Sort by views and take top 5
  const topCreators = creatorsWithEngagement.sort((a, b) => b.views - a.views).slice(0, 5);

  console.log(`✅ Metrics calculated: ${allInsights.length} posts, avg engagement ${averageEngagementRate.toFixed(2)}%`);
  console.log(`🏆 Top creator: ${topCreators[0]?.userName} with ${topCreators[0]?.views} views`);

  return {
    platform,
    totalPosts: allInsights.length,
    totalViews: totals.views,
    totalLikes: totals.likes,
    totalComments: totals.comments,
    totalShares: totals.shares,
    totalSaved: totals.saved,
    totalReach: totals.reach,
    averageEngagementRate: parseFloat(averageEngagementRate.toFixed(2)),
    topCreatorsByViews: topCreators,
  };
}

/**
 * Store insight snapshot in database
 */
export async function storeInsightSnapshot(
  campaignId: string,
  metrics: DailyMetrics,
  snapshotDate: Date
): Promise<void> {
  console.log(`💾 Storing snapshot for campaign ${campaignId}, platform ${metrics.platform}...`);

  try {
    await prisma.insightSnapshot.upsert({
      where: {
        campaignId_platform_snapshotDate: {
          campaignId,
          platform: metrics.platform,
          snapshotDate: dayjs(snapshotDate).startOf('day').toDate(),
        },
      },
      create: {
        campaignId,
        snapshotDate: dayjs(snapshotDate).startOf('day').toDate(),
        dayOfWeek: dayjs(snapshotDate).day(), // 0=Sun, 1=Mon, ...
        snapshotType: 'daily',
        platform: metrics.platform,
        totalPosts: metrics.totalPosts,
        totalViews: metrics.totalViews,
        totalLikes: metrics.totalLikes,
        totalComments: metrics.totalComments,
        totalShares: metrics.totalShares,
        totalSaved: metrics.totalSaved,
        totalReach: metrics.totalReach,
        averageEngagementRate: metrics.averageEngagementRate,
        topCreatorsByViews: metrics.topCreatorsByViews as any,
      },
      update: {
        totalPosts: metrics.totalPosts,
        totalViews: metrics.totalViews,
        totalLikes: metrics.totalLikes,
        totalComments: metrics.totalComments,
        totalShares: metrics.totalShares,
        totalSaved: metrics.totalSaved,
        totalReach: metrics.totalReach,
        averageEngagementRate: metrics.averageEngagementRate,
        topCreatorsByViews: metrics.topCreatorsByViews as any,
        dayOfWeek: dayjs(snapshotDate).day(), // Always update dayOfWeek
        updatedAt: new Date(),
      },
    });

    console.log(`✅ Snapshot stored successfully`);
  } catch (error: any) {
    console.error(`❌ Failed to store snapshot:`, error.message);
    throw error;
  }
}

/**
 * Get engagement heatmap data for last N weeks
 * Includes both snapshot data and manual creator entries
 */
export async function getEngagementHeatmap(
  campaignId: string,
  platform: string,
  weeks: number = 8
) {
  console.log(`📈 Fetching heatmap data for ${weeks} weeks...`);

  const startDate = dayjs().subtract(weeks, 'week').startOf('day').toDate();

  // Fetch snapshots
  const snapshots = await prisma.insightSnapshot.findMany({
    where: {
      campaignId,
      platform: platform === 'All' ? undefined : platform,
      snapshotDate: { gte: startDate },
      snapshotType: 'daily',
    },
    orderBy: { snapshotDate: 'asc' },
  });

  console.log(`📊 Found ${snapshots.length} snapshots`);

  // Fetch manual entries
  const manualEntries = await prisma.manualCreatorEntry.findMany({
    where: {
      campaignId,
      platform: platform === 'All' ? undefined : platform,
      createdAt: { gte: startDate },
    },
  });

  console.log(`📝 Found ${manualEntries.length} manual entries`);

  // Group manual entries by date (using createdAt, normalized to start of day)
  const manualEntriesByDate = new Map<string, any[]>();
  manualEntries.forEach((entry) => {
    const dateKey = dayjs(entry.createdAt).startOf('day').toISOString();
    if (!manualEntriesByDate.has(dateKey)) {
      manualEntriesByDate.set(dateKey, []);
    }
    manualEntriesByDate.get(dateKey)!.push(entry);
  });

  // Transform snapshots into date-keyed map
  const snapshotByDate = new Map<string, any>();
  snapshots.forEach((snapshot) => {
    const dateKey = dayjs(snapshot.snapshotDate).startOf('day').toISOString();
    snapshotByDate.set(dateKey, snapshot);
  });

  // Combine snapshot and manual entry data by date
  const combinedDates = new Set([
    ...Array.from(snapshotByDate.keys()),
    ...Array.from(manualEntriesByDate.keys()),
  ]);

  const heatmapData = Array.from(combinedDates).map((dateKey) => {
    const snapshot = snapshotByDate.get(dateKey);
    const manualEntriesForDate = manualEntriesByDate.get(dateKey) || [];

    // If we have both snapshot and manual entries, combine them
    if (snapshot && manualEntriesForDate.length > 0) {
      // Calculate totals from manual entries
      const manualTotals = manualEntriesForDate.reduce(
        (acc, entry) => ({
          views: acc.views + entry.views,
          likes: acc.likes + entry.likes,
          shares: acc.shares + entry.shares,
          saved: acc.saved + (entry.saved || 0),
        }),
        { views: 0, likes: 0, shares: 0, saved: 0 }
      );

      // Combine with snapshot totals
      const totalViews = snapshot.totalViews + manualTotals.views;
      const totalLikes = snapshot.totalLikes + manualTotals.likes;
      const totalShares = snapshot.totalShares + manualTotals.shares;
      const totalSaved = snapshot.totalSaved + manualTotals.saved;
      const totalPosts = snapshot.totalPosts + manualEntriesForDate.length;

      // Calculate combined engagement rate
      let engagementRate = snapshot.averageEngagementRate;
      if (platform === 'Instagram') {
        const denominator = snapshot.totalReach > 0 ? snapshot.totalReach : totalViews;
        if (denominator > 0) {
          engagementRate = ((totalLikes + snapshot.totalComments + totalShares + totalSaved) / denominator) * 100;
        }
      } else if (platform === 'TikTok') {
        if (totalViews > 0) {
          engagementRate = ((totalLikes + snapshot.totalComments + totalShares) / totalViews) * 100;
        }
      } else {
        const denominator = snapshot.totalReach > 0 ? snapshot.totalReach : totalViews;
        if (denominator > 0) {
          engagementRate = ((totalLikes + snapshot.totalComments + totalShares + totalSaved) / denominator) * 100;
        }
      }

      return {
        date: new Date(dateKey),
        engagementRate: parseFloat(engagementRate.toFixed(2)),
        totalPosts,
        totalViews,
      };
    }

    // If we only have snapshot data
    if (snapshot) {
      return {
        date: snapshot.snapshotDate,
        engagementRate: snapshot.averageEngagementRate,
        totalPosts: snapshot.totalPosts,
        totalViews: snapshot.totalViews,
      };
    }

    // If we only have manual entries for this date
    if (manualEntriesForDate.length > 0) {
      const manualTotals = manualEntriesForDate.reduce(
        (acc, entry) => ({
          views: acc.views + entry.views,
          likes: acc.likes + entry.likes,
          shares: acc.shares + entry.shares,
          saved: acc.saved + (entry.saved || 0),
        }),
        { views: 0, likes: 0, shares: 0, saved: 0 }
      );

      // Calculate engagement rate for manual entries only
      let engagementRate = 0;
      if (platform === 'Instagram') {
        if (manualTotals.views > 0) {
          engagementRate = ((manualTotals.likes + manualTotals.shares + manualTotals.saved) / manualTotals.views) * 100;
        }
      } else if (platform === 'TikTok') {
        if (manualTotals.views > 0) {
          engagementRate = ((manualTotals.likes + manualTotals.shares) / manualTotals.views) * 100;
        }
      } else {
        if (manualTotals.views > 0) {
          engagementRate = ((manualTotals.likes + manualTotals.shares + manualTotals.saved) / manualTotals.views) * 100;
        }
      }

      return {
        date: new Date(dateKey),
        engagementRate: parseFloat(engagementRate.toFixed(2)),
        totalPosts: manualEntriesForDate.length,
        totalViews: manualTotals.views,
      };
    }

    // Fallback (shouldn't happen)
    return {
      date: new Date(dateKey),
      engagementRate: 0,
      totalPosts: 0,
      totalViews: 0,
    };
  });

  // Sort by date
  heatmapData.sort((a, b) => a.date.getTime() - b.date.getTime());

  return heatmapData;
}

/**
 * Get top creators trend data for last N days
 */
export async function getTopCreatorsTrend(
  campaignId: string,
  platform: string,
  days: number = 7
) {
  console.log(`📈 Fetching top creators trend for ${days} days (platform: ${platform})...`);

  const startDate = dayjs().subtract(days, 'day').startOf('day').toDate();

  const snapshots = await prisma.insightSnapshot.findMany({
    where: {
      campaignId,
      platform: platform === 'All' ? undefined : platform,
      snapshotDate: { gte: startDate },
      snapshotType: 'daily',
    },
    orderBy: { snapshotDate: 'asc' },
  });

  console.log(`📊 Found ${snapshots.length} snapshots`);

  // Group snapshots by date
  const trendByDate = new Map<string, any[]>();

  snapshots.forEach((snapshot) => {
    const dateStr = snapshot.snapshotDate.toISOString();
    if (!trendByDate.has(dateStr)) {
      trendByDate.set(dateStr, []);
    }
    trendByDate.get(dateStr)!.push(snapshot);
  });

  // Combine creators from both platforms per date and get top 5
  const trendData = Array.from(trendByDate.entries())
    .map(([dateStr, snapshotsForDate]) => {
      let combinedCreators: any[] = [];

      snapshotsForDate.forEach((snapshot) => {
        if (snapshot.topCreatorsByViews) {
          combinedCreators = combinedCreators.concat(snapshot.topCreatorsByViews);
        }
      });

      // Remove duplicates (same creator might appear in multiple snapshots if fetched twice)
      const uniqueCreators = new Map<string, any>();
      combinedCreators.forEach((creator) => {
        const key = `${creator.userId}-${creator.userName}`;
        if (!uniqueCreators.has(key)) {
          uniqueCreators.set(key, creator);
        }
      });

      // Sort by views and take top 5
      const topCreators = Array.from(uniqueCreators.values())
        .sort((a, b) => (b.views || 0) - (a.views || 0))
        .slice(0, 5);

      return {
        date: new Date(dateStr),
        topCreators,
      };
    })
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  return trendData;
}

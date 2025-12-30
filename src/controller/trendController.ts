import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import {
  getEngagementHeatmap,
  getTopCreatorsTrend,
} from '@services/trendAnalysisService';
import { fetchAndStoreInsightsForCampaign } from '@services/insightFetchService';

const prisma = new PrismaClient();

/**
 * GET /api/campaign/:campaignId/trends/engagement-heatmap
 * Returns engagement data for heatmap visualization (8 weeks by default)
 *
 * Query params:
 * - platform: 'Instagram' | 'TikTok' | 'All' (default: 'All')
 * - weeks: number (default: 8)
 */
export const getEngagementHeatmapController = async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;
    const { platform = 'All', weeks = '6' } = req.query;

    // Validate campaign exists and user has access
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, name: true, status: true },
    });

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found',
      });
    }

    // Get heatmap data
    const heatmapData = await getEngagementHeatmap(
      campaignId,
      platform as string,
      parseInt(weeks as string, 10)
    );

    // Transform for frontend consumption
    const transformedData = transformHeatmapData(heatmapData, parseInt(weeks as string, 10));

    return res.status(200).json({
      success: true,
      data: {
        campaign: {
          id: campaign.id,
          name: campaign.name,
          status: campaign.status,
        },
        platform,
        weeks: parseInt(weeks as string, 10),
        heatmap: transformedData,
        summary: calculateHeatmapSummary(heatmapData),
      },
    });
  } catch (error: any) {
    console.error('Error fetching engagement heatmap:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch engagement heatmap',
      error: error.message,
    });
  }
};

/**
 * GET /api/campaign/:campaignId/trends/top-creators
 * Returns top creators trend data (7 days by default)
 *
 * Query params:
 * - platform: 'Instagram' | 'TikTok' | 'All' (default: 'All')
 * - days: number (default: 7)
 */
export const getTopCreatorsTrendController = async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;
    const { platform = 'All', days = '7' } = req.query;

    // Validate campaign exists
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, name: true, status: true },
    });

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found',
      });
    }

    // Get trend data
    const trendData = await getTopCreatorsTrend(
      campaignId,
      platform as string,
      parseInt(days as string, 10)
    );

    // Transform for frontend chart consumption
    const transformedData = transformTrendData(trendData);

    return res.status(200).json({
      success: true,
      data: {
        campaign: {
          id: campaign.id,
          name: campaign.name,
          status: campaign.status,
        },
        platform,
        days: parseInt(days as string, 10),
        trend: transformedData,
      },
    });
  } catch (error: any) {
    console.error('Error fetching top creators trend:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch top creators trend',
      error: error.message,
    });
  }
};

/**
 * GET /api/campaign/:campaignId/trends/summary
 * Returns overall trends summary for a campaign
 */
export const getTrendsSummaryController = async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;
    const { platform = 'All' } = req.query;

    // Validate campaign exists
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, name: true, status: true },
    });

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found',
      });
    }

    // Get latest snapshot for summary
    const latestSnapshot = await prisma.insightSnapshot.findFirst({
      where: {
        campaignId,
        platform: platform === 'All' ? undefined : (platform as string),
      },
      orderBy: { snapshotDate: 'desc' },
    });

    // Get snapshot count for date range
    const snapshotCount = await prisma.insightSnapshot.count({
      where: {
        campaignId,
        platform: platform === 'All' ? undefined : (platform as string),
      },
    });

    // Get URL counts by platform
    const urlCounts = await prisma.submissionPostingUrl.groupBy({
      by: ['platform'],
      where: {
        campaignId,
        postingDate: { not: null },
      },
      _count: { id: true },
    });

    return res.status(200).json({
      success: true,
      data: {
        campaign: {
          id: campaign.id,
          name: campaign.name,
          status: campaign.status,
        },
        latestSnapshot: latestSnapshot
          ? {
              date: latestSnapshot.snapshotDate,
              totalPosts: latestSnapshot.totalPosts,
              totalViews: latestSnapshot.totalViews,
              totalLikes: latestSnapshot.totalLikes,
              totalComments: latestSnapshot.totalComments,
              totalShares: latestSnapshot.totalShares,
              averageEngagementRate: latestSnapshot.averageEngagementRate,
              topCreators: latestSnapshot.topCreatorsByViews,
            }
          : null,
        snapshotCount,
        urlCounts: urlCounts.reduce(
          (acc, item) => {
            acc[item.platform] = item._count.id;
            return acc;
          },
          {} as Record<string, number>
        ),
      },
    });
  } catch (error: any) {
    console.error('Error fetching trends summary:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch trends summary',
      error: error.message,
    });
  }
};

/**
 * POST /api/campaign/:campaignId/trends/refresh
 * Manually trigger insight refresh for a campaign (admin only)
 */
export const refreshCampaignInsightsController = async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;

    // Validate campaign exists
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, name: true, status: true },
    });

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found',
      });
    }

    console.log(`🔄 Manual refresh triggered for campaign ${campaignId}`);

    // Fetch and store insights
    await fetchAndStoreInsightsForCampaign(campaignId);

    return res.status(200).json({
      success: true,
      message: `Insights refreshed for campaign: ${campaign.name}`,
    });
  } catch (error: any) {
    console.error('Error refreshing campaign insights:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to refresh campaign insights',
      error: error.message,
    });
  }
};

/**
 * Transform heatmap data into week x day grid format
 */
function transformHeatmapData(data: any[], weeks: number): any {
  // Create a grid structure: weeks x 7 days
  const grid: any[][] = [];
  const today = new Date();

  for (let w = 0; w < weeks; w++) {
    const weekData: any[] = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(today);
      date.setDate(date.getDate() - (weeks - 1 - w) * 7 - (6 - d));

      const dateStr = date.toISOString().split('T')[0];
      const snapshot = data.find(
        (s) => new Date(s.date).toISOString().split('T')[0] === dateStr
      );

      weekData.push({
        date: dateStr,
        dayOfWeek: d,
        weekIndex: w,
        engagementRate: snapshot?.engagementRate ?? null,
        totalViews: snapshot?.totalViews ?? null,
        totalPosts: snapshot?.totalPosts ?? null,
        hasData: !!snapshot,
      });
    }
    grid.push(weekData);
  }

  return grid;
}

/**
 * Transform trend data for chart consumption
 */
function transformTrendData(data: any[]): any {
  return data.map((day) => ({
    date: day.date,
    topCreators: day.topCreators || [],
  }));
}

/**
 * Calculate summary statistics for heatmap
 */
function calculateHeatmapSummary(data: any[]): any {
  if (data.length === 0) {
    return {
      totalDays: 0,
      avgEngagementRate: 0,
      maxEngagementRate: 0,
      minEngagementRate: 0,
      totalViews: 0,
      scales: getDefaultScales(),
    };
  }

  const engagementRates = data.map((d) => d.engagementRate).filter((r) => r !== null && r > 0);
  const views = data.reduce((sum, d) => sum + (d.totalViews || 0), 0);

  const min = engagementRates.length > 0 ? Math.min(...engagementRates) : 0;
  const max = engagementRates.length > 0 ? Math.max(...engagementRates) : 0;
  const avg = engagementRates.length > 0
    ? engagementRates.reduce((a, b) => a + b, 0) / engagementRates.length
    : 0;

  return {
    totalDays: data.length,
    avgEngagementRate: parseFloat(avg.toFixed(2)),
    maxEngagementRate: parseFloat(max.toFixed(2)),
    minEngagementRate: parseFloat(min.toFixed(2)),
    totalViews: views,
    scales: calculateDynamicScales(engagementRates),
  };
}

/**
 * Calculate dynamic scales based on actual data distribution
 * Uses quartiles to create meaningful color boundaries
 */
function calculateDynamicScales(engagementRates: number[]): {
  lowest: { min: number; max: number; label: string; color: string };
  mediumLow: { min: number; max: number; label: string; color: string };
  mediumHigh: { min: number; max: number; label: string; color: string };
  highest: { min: number; max: number; label: string; color: string };
} {
  if (engagementRates.length === 0) {
    return getDefaultScales();
  }

  // Sort rates for quartile calculation
  const sorted = [...engagementRates].sort((a, b) => a - b);
  
  const q1 = getPercentile(sorted, 25);
  const q2 = getPercentile(sorted, 50); // median
  const q3 = getPercentile(sorted, 75);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];

  return {
    lowest: {
      min: 0,
      max: parseFloat(q1.toFixed(2)),
      label: `< ${q1.toFixed(1)}%`,
      color: '#fee2e2', // light red
    },
    mediumLow: {
      min: parseFloat(q1.toFixed(2)),
      max: parseFloat(q2.toFixed(2)),
      label: `${q1.toFixed(1)}% - ${q2.toFixed(1)}%`,
      color: '#fef3c7', // light yellow
    },
    mediumHigh: {
      min: parseFloat(q2.toFixed(2)),
      max: parseFloat(q3.toFixed(2)),
      label: `${q2.toFixed(1)}% - ${q3.toFixed(1)}%`,
      color: '#d1fae5', // light green
    },
    highest: {
      min: parseFloat(q3.toFixed(2)),
      max: parseFloat((max + 1).toFixed(2)),
      label: `> ${q3.toFixed(1)}%`,
      color: '#10b981', // green
    },
  };
}

/**
 * Get percentile value from sorted array
 */
function getPercentile(sorted: number[], percentile: number): number {
  const index = (percentile / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  
  if (lower === upper) {
    return sorted[lower];
  }
  
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

/**
 * Default scales when no data is available
 */
function getDefaultScales() {
  return {
    lowest: { min: 0, max: 8, label: '< 8%', color: '#fee2e2' },
    mediumLow: { min: 8, max: 12, label: '8% - 12%', color: '#fef3c7' },
    mediumHigh: { min: 12, max: 18, label: '12% - 18%', color: '#d1fae5' },
    highest: { min: 18, max: 100, label: '> 18%', color: '#10b981' },
  };
}

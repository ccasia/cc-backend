import { Request, Response } from 'express';
import {
  getPostEngagementSnapshots,
  captureManualSnapshot,
  getPostEngagementTrend,
  getPostEngagementTrendByUrl,
  getCampaignPostTrends,
  captureDailyPostEngagementForUrl,
} from '@services/postEngagementSnapshotService';

/**
 * Get post engagement snapshots for a campaign
 * GET /api/campaigns/:campaignId/post-engagement-snapshots
 */
export const getCampaignPostSnapshots = async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;

    if (!campaignId) {
      return res.status(400).json({
        success: false,
        message: 'Campaign ID is required',
      });
    }

    const snapshots = await getPostEngagementSnapshots(campaignId);

    return res.status(200).json({
      success: true,
      data: snapshots,
    });
  } catch (error: any) {
    console.error('Error fetching post engagement snapshots:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch post engagement snapshots',
      error: error.message,
    });
  }
};

/**
 * Manually trigger snapshot capture for a specific post
 * POST /api/campaigns/:campaignId/post-engagement-snapshots/capture
 * Body: { postUrl: string, snapshotDay: 7 | 15 | 30 }
 */
export const triggerManualSnapshot = async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;
    const { postUrl, snapshotDay } = req.body;

    if (!campaignId || !postUrl || !snapshotDay) {
      return res.status(400).json({
        success: false,
        message: 'Campaign ID, post URL, and snapshot day are required',
      });
    }

    if (![7, 15, 30].includes(snapshotDay)) {
      return res.status(400).json({
        success: false,
        message: 'Snapshot day must be 7, 15, or 30',
      });
    }

    await captureManualSnapshot(campaignId, postUrl, snapshotDay);

    return res.status(200).json({
      success: true,
      message: `Snapshot captured for Day ${snapshotDay}`,
    });
  } catch (error: any) {
    console.error('Error capturing manual snapshot:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to capture snapshot',
      error: error.message,
    });
  }
};

/**
 * Get the daily engagement trend for a single submission (one post).
 * GET /api/campaigns/:campaignId/post-engagement-snapshots/daily/:submissionId?days=30
 *
 * Returns an ascending time series of {snapshotDate, daysSincePost, views,
 * engagementRate, ...} powering the per-post trend chart on the frontend.
 */
export const getPostDailyTrend = async (req: Request, res: Response) => {
  try {
    const { submissionId } = req.params;
    const { days } = req.query;

    if (!submissionId) {
      return res.status(400).json({
        success: false,
        message: 'Submission ID is required',
      });
    }

    const parsedDays = days ? parseInt(days as string, 10) : undefined;

    const trend = await getPostEngagementTrend(submissionId, {
      days: parsedDays && !Number.isNaN(parsedDays) ? parsedDays : undefined,
    });

    return res.status(200).json({
      success: true,
      data: trend,
    });
  } catch (error: any) {
    console.error('Error fetching post daily trend:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch post daily trend',
      error: error.message,
    });
  }
};

/**
 * Get the daily engagement trend for a single post identified by postUrl.
 * GET /api/campaigns/:campaignId/post-engagement-snapshots/daily-by-url?postUrl=<encoded>&days=42
 *
 * Same response shape as getPostDailyTrend, but keyed on the post URL —
 * used by the content performance report, which has the URL but not the
 * submission ID.
 */
export const getPostDailyTrendByUrl = async (req: Request, res: Response) => {
  try {
    const { postUrl, days } = req.query;

    if (!postUrl || typeof postUrl !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'postUrl query param is required',
      });
    }

    const parsedDays = days ? parseInt(days as string, 10) : undefined;

    const trend = await getPostEngagementTrendByUrl(postUrl, {
      days: parsedDays && !Number.isNaN(parsedDays) ? parsedDays : undefined,
    });

    return res.status(200).json({
      success: true,
      data: trend,
    });
  } catch (error: any) {
    console.error('Error fetching post daily trend by url:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch post daily trend',
      error: error.message,
    });
  }
};

/**
 * Get every per-post daily trend in a campaign, grouped by post.
 * GET /api/campaigns/:campaignId/post-engagement-snapshots/daily?days=30&platform=All
 *
 * Each entry is a single post with its time-series points; the frontend can
 * draw one line per post on a multi-line chart.
 */
export const getCampaignDailyTrends = async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;
    const { days, platform } = req.query;

    if (!campaignId) {
      return res.status(400).json({
        success: false,
        message: 'Campaign ID is required',
      });
    }

    const parsedDays = days ? parseInt(days as string, 10) : undefined;

    const trends = await getCampaignPostTrends(campaignId, {
      days: parsedDays && !Number.isNaN(parsedDays) ? parsedDays : undefined,
      platform: typeof platform === 'string' ? platform : undefined,
    });

    return res.status(200).json({
      success: true,
      data: trends,
    });
  } catch (error: any) {
    console.error('Error fetching campaign daily trends:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch campaign daily trends',
      error: error.message,
    });
  }
};

/**
 * Manually capture a daily snapshot for one posting URL (admin only).
 * POST /api/campaigns/:campaignId/post-engagement-snapshots/daily/capture
 * Body: { postUrl: string, snapshotDate?: string (ISO) }
 *
 * Mirrors the milestone manual-trigger endpoint but writes to the daily
 * table. Useful for spot-checking and for the simulation test script.
 */
export const triggerDailyCapture = async (req: Request, res: Response) => {
  try {
    const { postUrl, snapshotDate } = req.body;

    if (!postUrl) {
      return res.status(400).json({
        success: false,
        message: 'postUrl is required',
      });
    }

    const parsedDate = snapshotDate ? new Date(snapshotDate) : undefined;
    if (parsedDate && Number.isNaN(parsedDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'snapshotDate must be a valid ISO date string',
      });
    }

    const result = await captureDailyPostEngagementForUrl(postUrl, parsedDate);

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error('Error capturing daily snapshot:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to capture daily snapshot',
      error: error.message,
    });
  }
};

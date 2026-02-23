import { Request, Response } from 'express';
import {
  getPostEngagementSnapshots,
  captureManualSnapshot,
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

import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import {
  createManualCreatorEntry,
  getManualCreatorEntries,
  deleteManualCreatorEntry,
  updateManualCreatorEntry,
  validateUrl,
  detectPlatformFromUrl,
} from '@services/manualCreatorService';

const prisma = new PrismaClient();

/**
 * POST /api/campaign/:campaignId/manual-creator
 * Create a manual creator entry
 */
export const createEntry = async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;
    const { creatorName, creatorUsername, postUrl, views, likes, shares, saved, platform: providedPlatform } = req.body;
    const adminId = req.session.userid;

    // Validate required fields
    if (!creatorName || !creatorUsername) {
      return res.status(400).json({
        success: false,
        message: 'Creator name and username are required',
      });
    }

    if (views === undefined || likes === undefined || shares === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Views, likes, and shares are required',
      });
    }

    // Validate campaign exists
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, name: true },
    });

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found',
      });
    }

    // Validate and detect platform from URL if provided
    let platform = providedPlatform || 'Instagram';
    if (postUrl) {
      const urlValidation = validateUrl(postUrl);
      if (!urlValidation.isValid) {
        return res.status(400).json({
          success: false,
          message: urlValidation.reason || 'Invalid URL',
        });
      }

      const detectedPlatform = detectPlatformFromUrl(postUrl);
      if (detectedPlatform) {
        platform = detectedPlatform;
      }
    }

    // Create the entry
    const entry = await createManualCreatorEntry({
      campaignId,
      creatorName,
      creatorUsername,
      platform,
      postUrl,
      views: Number(views),
      likes: Number(likes),
      shares: Number(shares),
      saved: saved !== undefined ? Number(saved) : undefined,
      createdBy: adminId,
    });

    return res.status(201).json({
      success: true,
      message: 'Manual creator entry created successfully',
      data: entry,
    });
  } catch (error: any) {
    console.error('Error creating manual creator entry:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to create manual creator entry',
      error: error.message,
    });
  }
};

/**
 * GET /api/campaign/:campaignId/manual-creators
 * Get all manual creator entries for a campaign
 */
export const getEntries = async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;

    // Validate campaign exists
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true },
    });

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found',
      });
    }

    const entries = await getManualCreatorEntries(campaignId);

    return res.status(200).json({
      success: true,
      data: entries,
    });
  } catch (error: any) {
    console.error('Error fetching manual creator entries:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch manual creator entries',
      error: error.message,
    });
  }
};

/**
 * DELETE /api/campaign/:campaignId/manual-creator/:entryId
 * Delete a manual creator entry
 */
export const deleteEntry = async (req: Request, res: Response) => {
  try {
    const { campaignId, entryId } = req.params;

    // Check if entry exists
    const existing = await prisma.manualCreatorEntry.findFirst({
      where: {
        id: entryId,
        campaignId,
      },
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Manual creator entry not found',
      });
    }

    await deleteManualCreatorEntry(entryId, campaignId);

    return res.status(200).json({
      success: true,
      message: 'Manual creator entry deleted successfully',
    });
  } catch (error: any) {
    console.error('Error deleting manual creator entry:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete manual creator entry',
      error: error.message,
    });
  }
};

/**
 * PUT /api/campaign/:campaignId/manual-creator/:entryId
 * Update a manual creator entry
 */
export const updateEntry = async (req: Request, res: Response) => {
  try {
    const { campaignId, entryId } = req.params;
    const { creatorName, creatorUsername, postUrl, views, likes, shares, saved, platform } = req.body;

    // Check if entry exists
    const existing = await prisma.manualCreatorEntry.findFirst({
      where: {
        id: entryId,
        campaignId,
      },
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Manual creator entry not found',
      });
    }

    // Validate URL if provided
    if (postUrl) {
      const urlValidation = validateUrl(postUrl);
      if (!urlValidation.isValid) {
        return res.status(400).json({
          success: false,
          message: urlValidation.reason || 'Invalid URL',
        });
      }
    }

    const entry = await updateManualCreatorEntry(entryId, campaignId, {
      creatorName,
      creatorUsername,
      postUrl,
      views: views !== undefined ? Number(views) : undefined,
      likes: likes !== undefined ? Number(likes) : undefined,
      shares: shares !== undefined ? Number(shares) : undefined,
      saved: saved !== undefined ? Number(saved) : undefined,
      platform,
    });

    return res.status(200).json({
      success: true,
      message: 'Manual creator entry updated successfully',
      data: entry,
    });
  } catch (error: any) {
    console.error('Error updating manual creator entry:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to update manual creator entry',
      error: error.message,
    });
  }
};

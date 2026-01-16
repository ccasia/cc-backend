import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * GET /api/campaign/:campaignId/pcr
 * Get PCR (Post Campaign Report) data for a specific campaign
 */
export const getPCRData = async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;

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

    // Get PCR data for this campaign
    const pcrData = await prisma.campaignPCR.findUnique({
      where: { campaignId },
    });

    if (!pcrData) {
      // Return empty/default structure if no PCR data exists yet
      return res.status(200).json({
        success: true,
        data: {
          campaignId,
          campaignName: campaign.name,
          content: null,
          message: 'No PCR data found for this campaign',
        },
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        campaignId: pcrData.campaignId,
        campaignName: campaign.name,
        content: pcrData.content,
        updatedAt: pcrData.updatedAt,
      },
    });
  } catch (error: any) {
    console.error('Error fetching PCR data:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch PCR data',
      error: error.message,
    });
  }
};

/**
 * POST /api/campaign/:campaignId/pcr
 * Save/Update PCR data for a specific campaign
 */
export const savePCRData = async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;
    const { content } = req.body;

    if (!content) {
      return res.status(400).json({
        success: false,
        message: 'Content is required',
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

    // Upsert PCR data (create or update)
    const pcrData = await prisma.campaignPCR.upsert({
      where: { campaignId },
      update: {
        content,
        updatedAt: new Date(),
      },
      create: {
        campaignId,
        content,
      },
    });

    return res.status(200).json({
      success: true,
      message: 'PCR data saved successfully',
      data: {
        campaignId: pcrData.campaignId,
        campaignName: campaign.name,
        content: pcrData.content,
        updatedAt: pcrData.updatedAt,
      },
    });
  } catch (error: any) {
    console.error('Error saving PCR data:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to save PCR data',
      error: error.message,
    });
  }
};


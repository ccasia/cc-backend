import { Request, Response } from 'express';
import { handleDeleteAdminById } from '@services/adminService';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const getAllAdmins = async (req: Request, res: Response) => {
  try {
    const admins = await prisma.admin.findMany({
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            photoURL: true,
          },
        },
        role: true,
      },
    });

    return res.status(200).json(admins);
  } catch (error) {
    console.error('Error fetching admins:', error);
    return res.status(500).json({ message: 'Failed to fetch admins', error });
  }
};

export const deleteAdminById = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    await handleDeleteAdminById(id);
    return res.status(200).json({ message: 'Admin deleted.' });
  } catch (err) {
    return res.status(400).json({ message: err });
  }
};

export const disconnectXero = async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: {
        id: req.session.userid,
      },
    });

    if (!user) return res.status(404).json({ message: 'User not found' });

    console.log('asd');
  } catch (error) {
    console.log(error);
    return res.status(400).json({ message: 'Failed to disconnect xero' });
  }
};

export const exportCampaignCreators = async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;
    const { spreadSheetId, sheetByTitle } = req.body;

    if (!spreadSheetId || !sheetByTitle) {
      return res.status(400).json({ 
        message: 'Missing required parameters: spreadSheetId and sheetByTitle' 
      });
    }

    // Import the export function using require
    const sheetsModule = require('../service/google_sheets/sheets');
    const { exportCampaignCreatorsToSheet } = sheetsModule;

    const result = await exportCampaignCreatorsToSheet({
      spreadSheetId,
      sheetByTitle,
      campaignId,
    });

    return res.status(200).json({
      message: `Successfully exported ${result.exportedCount} creators from "${result.campaignName}"`,
      ...result,
    });
  } catch (error) {
    console.error('Export error:', error);
    return res.status(500).json({ 
      message: error.message || 'Failed to export campaign creators' 
    });
  }
};

export const exportAllCampaignCreators = async (req: Request, res: Response) => {
  try {
    const { spreadSheetId, sheetByTitle } = req.body;

    if (!spreadSheetId || !sheetByTitle) {
      return res.status(400).json({ 
        message: 'Missing required parameters: spreadSheetId and sheetByTitle' 
      });
    }

    // Import the export function using require
    const sheetsModule = require('../service/google_sheets/sheets');
    const { exportAllCampaignCreatorsToSheet } = sheetsModule;

    const result = await exportAllCampaignCreatorsToSheet({
      spreadSheetId,
      sheetByTitle,
    });

    return res.status(200).json({
      message: `Successfully exported ${result.totalExportedCount} creators from ${result.totalCampaigns} campaigns`,
      ...result,
    });
  } catch (error) {
    console.error('Export error:', error);
    return res.status(500).json({ 
      message: error.message || 'Failed to export all campaign creators' 
    });
  }
};

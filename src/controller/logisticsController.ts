import { Request, Response } from 'express';
import { fetchAllLogisticsForCampaign, fetchAllLogisticsForCreator } from '@services/logisticsService';

export const getLogisticsForCampaign = async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;
    if (!campaignId) {
      return res.status(400).json({ message: 'Campaign ID is required.' });
    }
    const logistics = await fetchAllLogisticsForCampaign(campaignId);
    return res.status(200).json(logistics);
  } catch (error) {
    console.error('Error fetching logistics for campaign:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

export const getCreatorLogistics = async (req: Request, res: Response) => {
  try {
    const { userid } = (req as any).session;

    const logistics = await fetchAllLogisticsForCreator(userid);
    return res.status(200).json(logistics);
  } catch (error) {
    console.error('Error fetching creator logistics:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

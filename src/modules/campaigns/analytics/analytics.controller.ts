import { Request, Response } from 'express';
import { getAnalytics } from './analytics.service';

export const getCampaignAnalytics = async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;
    const userId = req.userId;

    const analytics = await getAnalytics(campaignId);

    res.send(analytics);
  } catch (error) {
    if (error instanceof Error) {
      return res.status(500).json({ error });
    }
    res.status(500).json({ error: 'Error fetching analytics data.' });
  }
};

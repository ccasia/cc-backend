import { Request, Response } from 'express';
import { getCampaignOverview } from './overview.service';

export const getCampaignOverviewHandler = async (req: Request, res: Response) => {
  try {
    const overview = await getCampaignOverview(req.userId as string, req.params.campaignId);
    // Same 403 whether the campaign is missing or not theirs, so IDs can't be probed.
    if (!overview) return res.status(403).json({ message: 'Forbidden' });

    return res.status(200).json(overview);
  } catch (error) {
    console.error('Error fetching campaign overview:', error);
    return res.status(500).json({ message: 'Error fetching campaign overview' });
  }
};

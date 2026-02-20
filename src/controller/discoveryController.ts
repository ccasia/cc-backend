import { Request, Response } from 'express';
import { getDiscoveryCreators } from '@services/discoveryService';

export const getDiscoveryCreatorsList = async (req: Request, res: Response) => {
  try {
    const data = await getDiscoveryCreators({
      search: req.query.search as string,
      platform: req.query.platform as 'all' | 'instagram' | 'tiktok',
      page: parseInt(req.query.page as string, 10) || 1,
      limit: parseInt(req.query.limit as string, 10) || 20,
      hydrateMissing: req.query.hydrateMissing === 'true',
    });

    return res.status(200).json(data);
  } catch (error: any) {
    console.error('Error fetching discovery creators:', error);
    return res.status(500).json({ message: 'Failed to fetch discovery creators' });
  }
};

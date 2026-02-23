import { Request, Response } from 'express';
import { getDiscoveryCreators } from '@services/discoveryService';

export const getDiscoveryCreatorsList = async (req: Request, res: Response) => {
  try {
    // Parse interests from comma-separated string or JSON array
    let interests: string[] | undefined;
    if (req.query.interests) {
      const raw = req.query.interests as string;
      try {
        interests = JSON.parse(raw);
      } catch {
        interests = raw.split(',').map((s) => s.trim()).filter(Boolean);
      }
    }

    const data = await getDiscoveryCreators({
      search: req.query.search as string,
      platform: req.query.platform as 'all' | 'instagram' | 'tiktok',
      page: parseInt(req.query.page as string, 10) || 1,
      limit: parseInt(req.query.limit as string, 10) || 20,
      hydrateMissing: req.query.hydrateMissing === 'true',
      gender: (req.query.gender as string) || undefined,
      ageRange: (req.query.ageRange as string) || undefined,
      country: (req.query.country as string) || undefined,
      city: (req.query.city as string) || undefined,
      creditTier: (req.query.creditTier as string) || undefined,
      interests,
      keyword: (req.query.keyword as string) || undefined,
      hashtag: (req.query.hashtag as string) || undefined,
    });

    return res.status(200).json(data);
  } catch (error: any) {
    console.error('Error fetching discovery creators:', error);
    return res.status(500).json({ message: 'Failed to fetch discovery creators' });
  }
};

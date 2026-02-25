import { Request, Response } from 'express';
import { getDiscoveryCreators } from '@services/discoveryService';

const parseInterestsQuery = (value?: string | string[]) => {
  if (!value) return undefined;

  const raw = Array.isArray(value) ? value.join(',') : value;

  try {
    return JSON.parse(raw);
  } catch {
    return raw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
};

const parsePositiveInt = (value: unknown, fallback: number) => {
  const parsed = parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const getDiscoveryCreatorsList = async (req: Request, res: Response) => {
  try {
    const interests = parseInterestsQuery(req.query.interests as string | string[] | undefined);

    const data = await getDiscoveryCreators({
      search: req.query.search as string,
      platform: req.query.platform as 'all' | 'instagram' | 'tiktok',
      page: parsePositiveInt(req.query.page, 1),
      limit: parsePositiveInt(req.query.limit, 20),
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

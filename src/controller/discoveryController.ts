import { Request, Response } from 'express';
import { getDiscoveryCreators, inviteDiscoveryCreators } from '@services/discoveryService';

const parseStringArrayQuery = (value?: string | string[]) => {
  if (!value) return undefined;

  const raw = Array.isArray(value) ? value.join(',') : value;

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item).trim()).filter(Boolean);
    }

    return undefined;
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

const parseSortBy = (value: unknown): 'name' | 'followers' => {
  return value === 'followers' ? 'followers' : 'name';
};

const parseSortDirection = (value: unknown): 'asc' | 'desc' => {
  return value === 'desc' ? 'desc' : 'asc';
};

export const getDiscoveryCreatorsList = async (req: Request, res: Response) => {
  try {
    const interests = parseStringArrayQuery(req.query.interests as string | string[] | undefined);
    const languages = parseStringArrayQuery(req.query.languages as string | string[] | undefined);

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
      languages,
      interests,
      keyword: (req.query.keyword as string) || undefined,
      hashtag: (req.query.hashtag as string) || undefined,
      sortBy: parseSortBy(req.query.sortBy),
      sortDirection: parseSortDirection(req.query.sortDirection),
    });

    return res.status(200).json(data);
  } catch (error: any) {
    console.error('Error fetching discovery creators:', error);
    return res.status(500).json({ message: 'Failed to fetch discovery creators' });
  }
};

export const inviteDiscoveryCreatorsController = async (req: Request, res: Response) => {
  const userId = req.session.userid;
  const { campaignId, creatorIds, creators } = req.body || {};

  try {
    const normalizedCreatorIds = Array.from(
      new Set(
        [
          ...(Array.isArray(creatorIds) ? creatorIds : []),
          ...(Array.isArray(creators) ? creators.map((creator) => creator?.id) : []),
        ]
          .map((id) => String(id || '').trim())
          .filter(Boolean),
      ),
    );

    const data = await inviteDiscoveryCreators({
      campaignId: String(campaignId || '').trim(),
      creatorIds: normalizedCreatorIds,
      invitedByUserId: userId,
    });

    return res.status(200).json({
      message: 'Creators invited successfully',
      ...data,
    });
  } catch (error: any) {
    console.error('Error inviting discovery creators:', error);
    return res.status(400).json({
      message: error?.message || 'Failed to invite discovery creators',
    });
  }
};

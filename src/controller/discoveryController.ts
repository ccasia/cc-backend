import { Request, Response } from 'express';
import {
  addCreatorToList,
  createBookmarkList,
  deleteBookmarkList,
  getBookmarkLists,
  getBookmarkedCreatorsByLists,
  getDiscoveryCreators,
  getDiscoveryCreatorsExportData,
  getNonPlatformDiscoveryCreators,
  inviteDiscoveryCreators,
  isDiscoveryBookmarkPlatform,
  removeCreatorFromList,
} from '@services/discoveryService';
import { prisma } from '../prisma/prisma';

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

const parseNonPlatform = (value: unknown): 'all' | 'instagram' | 'tiktok' => {
  if (value === 'instagram' || value === 'tiktok') {
    return value;
  }

  return 'all';
};

const parseNonNegativeInt = (value: unknown): number | undefined => {
  if (value == null || value === '') return undefined;

  const parsed = parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }

  return parsed;
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

export const getDiscoveryCreatorsExportDataController = async (req: Request, res: Response) => {
  try {
    const interests = parseStringArrayQuery(req.query.interests as string | string[] | undefined);
    const languages = parseStringArrayQuery(req.query.languages as string | string[] | undefined);

    const data = await getDiscoveryCreatorsExportData({
      search: req.query.search as string,
      platform: req.query.platform as 'all' | 'instagram' | 'tiktok',
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
    console.error('Error exporting discovery creators:', error);
    return res.status(500).json({ message: 'Failed to export discovery creators' });
  }
};

export const getNonPlatformDiscoveryCreatorsList = async (req: Request, res: Response) => {
  try {
    const data = await getNonPlatformDiscoveryCreators({
      platform: parseNonPlatform(req.query.platform),
      keyword: (req.query.keyword as string) || undefined,
      followers: parseNonNegativeInt(req.query.followers),
      page: parsePositiveInt(req.query.page, 1),
      limit: parsePositiveInt(req.query.limit, 20),
    });

    return res.status(200).json(data);
  } catch (error: any) {
    console.error('Error fetching non-platform discovery creators:', error);
    return res.status(500).json({ message: 'Failed to fetch non-platform discovery creators' });
  }
};

export const getBookmarkListsController = async (req: Request, res: Response) => {
  const userId = req.userId;

  if (!userId) return res.status(401).json({ message: 'Unauthorized' });

  try {
    const data = await getBookmarkLists(userId);
    return res.status(200).json(data);
  } catch (error: any) {
    console.error('Error fetching bookmark lists:', error);
    return res.status(500).json({ message: 'Failed to fetch bookmark lists' });
  }
};

export const createBookmarkListController = async (req: Request, res: Response) => {
  const userId = req.userId;

  if (!userId) return res.status(401).json({ message: 'Unauthorized' });

  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ message: 'List name is required' });

  try {
    const list = await createBookmarkList(userId, name);
    return res.status(201).json({ message: 'List created', list });
  } catch (error: any) {
    console.error('Error creating bookmark list:', error);
    return res.status(400).json({ message: error?.message || 'Failed to create list' });
  }
};

export const deleteBookmarkListController = async (req: Request, res: Response) => {
  const userId = req.userId;

  if (!userId) return res.status(401).json({ message: 'Unauthorized' });

  const listId = String(req.params.listId || '').trim();
  if (!listId) return res.status(400).json({ message: 'listId is required' });

  try {
    const data = await deleteBookmarkList(userId, listId);
    return res.status(200).json({ message: 'List deleted', ...data });
  } catch (error: any) {
    console.error('Error deleting bookmark list:', error);
    return res.status(400).json({ message: error?.message || 'Failed to delete list' });
  }
};

export const getBookmarkListCreatorsController = async (req: Request, res: Response) => {
  const userId = req.userId;

  if (!userId) return res.status(401).json({ message: 'Unauthorized' });

  const listIds = parseStringArrayQuery(req.query.listIds as string | string[] | undefined) || [];

  try {
    const data = await getBookmarkedCreatorsByLists(userId, listIds);
    return res.status(200).json(data);
  } catch (error: any) {
    console.error('Error fetching bookmark list creators:', error);
    return res.status(500).json({ message: 'Failed to fetch bookmarked creators' });
  }
};

export const addCreatorToListController = async (req: Request, res: Response) => {
  const userId = req.userId;

  if (!userId) return res.status(401).json({ message: 'Unauthorized' });

  const listId = String(req.params.listId || '').trim();
  const creatorUserId = String(req.body?.creatorUserId || '').trim();
  const platform = req.body?.platform;

  if (!listId) return res.status(400).json({ message: 'listId is required' });
  if (!creatorUserId) return res.status(400).json({ message: 'creatorUserId is required' });
  if (!isDiscoveryBookmarkPlatform(platform)) {
    return res.status(400).json({ message: 'platform must be instagram or tiktok' });
  }

  try {
    const bookmark = await addCreatorToList(userId, listId, creatorUserId, platform);
    return res.status(200).json({ message: 'Creator added to list', bookmark });
  } catch (error: any) {
    console.error('Error adding creator to list:', error);
    return res.status(400).json({ message: error?.message || 'Failed to add creator to list' });
  }
};

export const removeCreatorFromListController = async (req: Request, res: Response) => {
  const userId = req.userId;

  if (!userId) return res.status(401).json({ message: 'Unauthorized' });

  const listId = String(req.params.listId || '').trim();
  const creatorUserId = String(req.query.creatorUserId || '').trim();
  const platform = req.query.platform;

  if (!listId) return res.status(400).json({ message: 'listId is required' });
  if (!creatorUserId) return res.status(400).json({ message: 'creatorUserId is required' });
  if (!isDiscoveryBookmarkPlatform(platform)) {
    return res.status(400).json({ message: 'platform must be instagram or tiktok' });
  }

  try {
    const data = await removeCreatorFromList(userId, listId, creatorUserId, platform);
    return res.status(200).json({ message: 'Creator removed from list', ...data });
  } catch (error: any) {
    console.error('Error removing creator from list:', error);
    return res.status(400).json({ message: error?.message || 'Failed to remove creator from list' });
  }
};

export const inviteDiscoveryCreatorsController = async (req: Request, res: Response) => {
  const userId = req.userId;

  if (!userId) return res.status(401).json({ message: 'Unathorized' });

  const { campaignId, creatorIds, creators } = req.body || {};

  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (user?.role === 'client_demo') {
      return res.status(403).json({ message: 'Demo clients cannot invite creators to campaigns' });
    }

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

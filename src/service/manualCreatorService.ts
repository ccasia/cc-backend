import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface CreateManualCreatorInput {
  campaignId: string;
  creatorName: string;
  creatorUsername: string;
  platform: string;
  postUrl?: string;
  views: number;
  likes: number;
  shares: number;
  saved?: number;
  createdBy: string;
}

//Calculate engagement rate based on platform
// Instagram: (likes + shares + saved) / views * 100
// TikTok: (likes + shares) / views * 100
export const calculateEngagementRate = (
  platform: string,
  views: number,
  likes: number,
  shares: number,
  saved?: number,
): number => {
  if (views === 0) return 0;

  if (platform === 'Instagram') {
    return ((likes + shares + (saved || 0)) / views) * 100;
  }
  // TikTok
  return ((likes + shares) / views) * 100;
};

//Detect platform from URL
export const detectPlatformFromUrl = (url: string): string | null => {
  if (!url) return null;

  const lowercaseUrl = url.toLowerCase();

  if (lowercaseUrl.includes('instagram.com') || lowercaseUrl.includes('instagr.am')) {
    return 'Instagram';
  }

  if (lowercaseUrl.includes('tiktok.com') || lowercaseUrl.includes('vm.tiktok.com')) {
    return 'TikTok';
  }

  return null;
};

//Validate URL format
export const validateUrl = (url: string, expectedPlatform?: string): { isValid: boolean; reason?: string } => {
  if (!url) {
    return { isValid: true }; // URL is optional
  }

  try {
    const parsedUrl = new URL(url);
    const platform = detectPlatformFromUrl(url);

    if (!platform) {
      return {
        isValid: false,
        reason: 'URL must be from Instagram or TikTok',
      };
    }

    // If an expected platform is provided, validate that the URL matches it
    if (expectedPlatform && platform !== expectedPlatform) {
      return {
        isValid: false,
        reason: `URL must be from ${expectedPlatform}. Current URL is from ${platform}.`,
      };
    }

    return { isValid: true };
  } catch {
    return {
      isValid: false,
      reason: 'Invalid URL format',
    };
  }
};

//Create a manual creator entry
export const createManualCreatorEntry = async (input: CreateManualCreatorInput) => {
  const { campaignId, creatorName, creatorUsername, platform, postUrl, views, likes, shares, saved, createdBy } = input;

  const engagementRate = calculateEngagementRate(platform, views, likes, shares, saved);

  const entry = await prisma.manualCreatorEntry.create({
    data: {
      campaignId,
      creatorName,
      creatorUsername,
      platform,
      postUrl: postUrl || null,
      views,
      likes,
      shares,
      saved: platform === 'Instagram' ? saved : null,
      engagementRate,
      createdBy,
    },
  });

  return entry;
};

//Get all manual creator entries for a campaign
export const getManualCreatorEntries = async (campaignId: string) => {
  const entries = await prisma.manualCreatorEntry.findMany({
    where: { campaignId },
    orderBy: { createdAt: 'desc' },
  });

  return entries;
};

//Delete a manual creator entry
export const deleteManualCreatorEntry = async (entryId: string, campaignId: string) => {
  const entry = await prisma.manualCreatorEntry.delete({
    where: {
      id: entryId,
      campaignId,
    },
  });

  return entry;
};

//Update a manual creator entry
export const updateManualCreatorEntry = async (
  entryId: string,
  campaignId: string,
  data: Partial<CreateManualCreatorInput>,
) => {
  const existing = await prisma.manualCreatorEntry.findUnique({
    where: { id: entryId },
  });

  if (!existing) {
    throw new Error('Manual creator entry not found');
  }

  // Recalculate engagement rate if metrics changed
  let engagementRate: number | undefined;
  if (data.views !== undefined || data.likes !== undefined || data.shares !== undefined || data.saved !== undefined) {
    const platform = data.platform || existing.platform;
    const views = data.views ?? existing.views;
    const likes = data.likes ?? existing.likes;
    const shares = data.shares ?? existing.shares;
    const saved = data.saved ?? existing.saved ?? undefined;

    engagementRate = calculateEngagementRate(platform, views, likes, shares, saved);
  }

  const entry = await prisma.manualCreatorEntry.update({
    where: {
      id: entryId,
      campaignId,
    },
    data: {
      ...data,
      ...(engagementRate !== undefined && { engagementRate }),
    },
  });

  return entry;
};

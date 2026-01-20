import { PrismaClient, CreditTier } from '@prisma/client';

const prisma = new PrismaClient();

interface FollowerData {
  instagramFollowers?: number | null;
  tiktokFollowers?: number | null;
  manualFollowers?: number | null;
}

interface TierCalculationResult {
  followerCount: number;
  tier: CreditTier | null;
}

interface CreditCostResult {
  totalCredits: number;
  creditPerVideo: number;
  tier: CreditTier;
}

/**
 * Get the highest follower count from all sources
 * Priority: Media Kit (Instagram/TikTok) supersedes Manual input
 * If media kit exists, uses highest between Instagram and TikTok
 */
export const getHighestFollowerCount = (data: FollowerData): number => {
  const instagram = data.instagramFollowers ?? 0;
  const tiktok = data.tiktokFollowers ?? 0;
  const manual = data.manualFollowers ?? 0;

  // If media kit exists (Instagram or TikTok has data), ignore manual count
  if (instagram > 0 || tiktok > 0) {
    return Math.max(instagram, tiktok);
  }

  return manual;
};

/**
 * Get credit tier based on follower count
 * Returns null if follower count is 0 or no matching tier found
 */
export const getTierByFollowerCount = async (followerCount: number): Promise<CreditTier | null> => {
  if (followerCount === 0) {
    return null; // No tier for creators without follower data
  }

  // Find the tier where followerCount falls within the range
  const tier = await prisma.creditTier.findFirst({
    where: {
      isActive: true,
      minFollowers: { lte: followerCount },
      OR: [
        { maxFollowers: { gte: followerCount } },
        { maxFollowers: null }, // Unlimited upper bound (e.g., Macro+ tier)
      ],
    },
    orderBy: [
      { minFollowers: 'desc' }, // Get the highest matching tier
    ],
  });

  return tier;
};

/**
 * Calculate credit tier for a creator based on their follower data
 * Fetches Instagram, TikTok, and manual follower counts
 */
export const calculateCreatorTier = async (userId: string): Promise<TierCalculationResult> => {
  const creator = await prisma.creator.findUnique({
    where: { userId },
    include: {
      tiktokUser: {
        select: { follower_count: true },
      },
      instagramUser: {
        select: { followers_count: true },
      },
    },
  });

  if (!creator) {
    throw new Error('Creator not found');
  }

  const followerCount = getHighestFollowerCount({
    instagramFollowers: creator.instagramUser?.followers_count,
    tiktokFollowers: creator.tiktokUser?.follower_count,
    manualFollowers: creator.manualFollowerCount,
  });

  const tier = await getTierByFollowerCount(followerCount);

  return {
    followerCount,
    tier,
  };
};

/**
 * Update creator's credit tier in the database
 * Called when follower counts change (social media sync, manual input)
 */
export const updateCreatorTier = async (
  userId: string,
  prismaFunc?: PrismaClient
): Promise<CreditTier | null> => {
  const tx = prismaFunc ?? prisma;

  const { tier } = await calculateCreatorTier(userId);

  await tx.creator.update({
    where: { userId },
    data: {
      creditTierId: tier?.id ?? null,
      tierUpdatedAt: new Date(),
    },
  });

  return tier;
};

/**
 * Batch update tiers for multiple creators
 * Useful for migration scripts and bulk updates
 */
export const batchUpdateCreatorTiers = async (
  userIds: string[]
): Promise<{ userId: string; success: boolean; tier?: CreditTier | null; error?: string }[]> => {
  const results = [];

  for (const userId of userIds) {
    try {
      const tier = await updateCreatorTier(userId);
      results.push({ userId, success: true, tier });
    } catch (error: any) {
      results.push({ userId, success: false, error: error.message });
    }
  }

  return results;
};

/**
 * Calculate total credit cost for a creator based on video count and their tier
 * Used when shortlisting/assigning creators to credit tier campaigns
 */
export const calculateCreatorCreditCost = async (
  userId: string,
  videoCount: number
): Promise<CreditCostResult> => {
  const { tier, followerCount } = await calculateCreatorTier(userId);

  if (!tier) {
    throw new Error(
      followerCount === 0
        ? 'Creator does not have follower data. Please connect media kit or enter follower count manually.'
        : 'No credit tier found for this creator\'s follower count.'
    );
  }

  const totalCredits = tier.creditsPerVideo * videoCount;

  return {
    totalCredits,
    creditPerVideo: tier.creditsPerVideo,
    tier,
  };
};

/**
 * Check if creator can pitch to a credit tier campaign
 * Returns true if creator has valid follower data (from any source)
 */
export const canPitchToCreditTierCampaign = async (userId: string): Promise<boolean> => {
  try {
    const { followerCount } = await calculateCreatorTier(userId);
    return followerCount > 0;
  } catch {
    return false;
  }
};

/**
 * Get all active credit tiers ordered by minimum followers
 */
export const getAllActiveTiers = async (): Promise<CreditTier[]> => {
  return prisma.creditTier.findMany({
    where: { isActive: true },
    orderBy: { minFollowers: 'asc' },
  });
};

/**
 * Get a creator's current tier info (with tier details)
 * Useful for API responses and display
 */
export const getCreatorTierInfo = async (
  userId: string
): Promise<{
  followerCount: number;
  tier: CreditTier | null;
  source: 'instagram' | 'tiktok' | 'manual' | 'none';
}> => {
  const creator = await prisma.creator.findUnique({
    where: { userId },
    include: {
      tiktokUser: {
        select: { follower_count: true },
      },
      instagramUser: {
        select: { followers_count: true },
      },
      creditTier: true,
    },
  });

  if (!creator) {
    throw new Error('Creator not found');
  }

  const instagram = creator.instagramUser?.followers_count ?? 0;
  const tiktok = creator.tiktokUser?.follower_count ?? 0;
  const manual = creator.manualFollowerCount ?? 0;

  let followerCount: number;
  let source: 'instagram' | 'tiktok' | 'manual' | 'none';

  // Determine follower count and source
  if (instagram > 0 || tiktok > 0) {
    if (instagram >= tiktok) {
      followerCount = instagram;
      source = 'instagram';
    } else {
      followerCount = tiktok;
      source = 'tiktok';
    }
  } else if (manual > 0) {
    followerCount = manual;
    source = 'manual';
  } else {
    followerCount = 0;
    source = 'none';
  }

  return {
    followerCount,
    tier: creator.creditTier,
    source,
  };
};

/**
 * Update a creator's manual follower count
 * Used when creators without media kit enter their follower count manually
 */
export const updateManualFollowerCount = async (
  userId: string,
  followerCount: number
): Promise<CreditTier | null> => {
  // Validate follower count
  if (followerCount < 0) {
    throw new Error('Follower count cannot be negative');
  }

  // Cap at reasonable maximum to prevent abuse
  const maxFollowerCount = 10000000; // 10 million
  if (followerCount > maxFollowerCount) {
    throw new Error(`Follower count cannot exceed ${maxFollowerCount.toLocaleString()}`);
  }

  // Update manual follower count and recalculate tier
  await prisma.creator.update({
    where: { userId },
    data: {
      manualFollowerCount: Math.floor(followerCount),
    },
  });

  // Recalculate and update tier
  return updateCreatorTier(userId);
};

/**
 * Calculate total credits used/assigned in a credit tier campaign
 * Considers per-video costs for each shortlisted creator
 */
export const calculateCampaignCreditsUsed = async (campaignId: string): Promise<number> => {
  const shortlisted = await prisma.shortListedCreator.findMany({
    where: {
      campaignId,
      ugcVideos: { gt: 0 },
    },
    select: {
      ugcVideos: true,
      creditPerVideo: true,
    },
  });

  return shortlisted.reduce((total, creator) => {
    const videos = creator.ugcVideos ?? 0;
    const perVideo = creator.creditPerVideo ?? 1; // Default to 1 for non-tier assignments
    return total + videos * perVideo;
  }, 0);
};

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface SocialMediaAnalytics {
  followers: number;
  engagement_rate: number;
  averageLikes: number;
  averageComments: number;
  totalLikes: number;
  totalComments: number;
  monthlyEngagement?: {
    month: string;
    rate: number;
  }[];
}

export const calculateInstagramAnalytics = async (creatorId: string): Promise<SocialMediaAnalytics> => {
  const instagramUser = await prisma.instagramUser.findUnique({
    where: { creatorId },
  });

  if (!instagramUser) {
    return {
      followers: 0,
      engagement_rate: 0,
      averageLikes: 0,
      averageComments: 0,
      totalLikes: 0,
      totalComments: 0,
    };
  }

  const { followers_count, totalLikes, totalComments, averageLikes, averageComments } = instagramUser;

  // Calculate engagement rate using industry standard formula
  // Formula: (Average Likes + Average Comments) / Followers × 100
  // Note: Instagram Graph API doesn't provide shares/saves to third-party apps
  const engagement_rate = followers_count
    ? (((averageLikes || 0) + (averageComments || 0)) / followers_count) * 100
    : 0;

  return {
    followers: followers_count || 0,
    engagement_rate: Number(engagement_rate.toFixed(2)),
    averageLikes: averageLikes || 0,
    averageComments: averageComments || 0,
    totalLikes: totalLikes || 0,
    totalComments: totalComments || 0,
  };
};

export const calculateTikTokAnalytics = async (creatorId: string): Promise<SocialMediaAnalytics> => {
  const tiktokUser = await prisma.tiktokUser.findUnique({
    where: { creatorId },
  });

  if (!tiktokUser) {
    return {
      followers: 0,
      engagement_rate: 0,
      averageLikes: 0,
      averageComments: 0,
      totalLikes: 0,
      totalComments: 0,
    };
  }

  const { follower_count, averageLikes, averageComments, averageShares, totalLikes, totalComments } = tiktokUser;

  // Calculate engagement rate for TikTok using industry standard formula
  // Formula: (Average Likes + Average Comments + Average Shares) / Followers × 100
  const engagement_rate = follower_count
    ? (((averageLikes || 0) + (averageComments || 0) + (averageShares || 0)) / follower_count) * 100
    : 0;

  return {
    followers: follower_count || 0,
    engagement_rate: Number(engagement_rate.toFixed(2)),
    averageLikes: averageLikes || 0,
    averageComments: averageComments || 0,
    totalLikes: totalLikes || 0,
    totalComments: totalComments || 0,
  };
};

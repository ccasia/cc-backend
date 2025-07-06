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

  const {
    followers_count,
    totalLikes,
    totalComments,
    averageLikes,
    averageComments,
  } = instagramUser;

  // Calculate engagement rate: (totalLikes + totalComments) / followers * 100
  const engagement_rate = followers_count 
    ? ((totalLikes || 0) + (totalComments || 0)) / followers_count * 100 
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

  const {
    follower_count,
    likes_count,
    averageComments,
  } = tiktokUser;

  // Calculate engagement rate for TikTok: (likes + comments) / followers * 100
  const engagement_rate = follower_count 
    ? ((likes_count || 0) + (averageComments || 0)) / (follower_count || 0) * 100 
    : 0;

  return {
    followers: follower_count || 0,
    engagement_rate: Number(engagement_rate.toFixed(2)),
    averageLikes: likes_count || 0, // TikTok provides total likes, not average
    averageComments: averageComments || 0,
    totalLikes: likes_count || 0,
    totalComments: averageComments || 0, // Using averageComments as total for now
  };
}; 
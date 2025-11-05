import { InstagramUser, TiktokUser } from '@prisma/client';

export const calculateAverageMetrics = (instagramUser: InstagramUser | null, tiktokUser: TiktokUser | null) => {
  const followerCounts: number[] = [];
  const engagementRates: number[] = [];

  // Add instagram data
  if (instagramUser?.followers_count) {
    followerCounts.push(instagramUser.followers_count);
  }
  if (instagramUser?.engagement_rate) {
    engagementRates.push(instagramUser.engagement_rate);
  }

  // Add tiktok data
  if (tiktokUser?.follower_count) {
    followerCounts.push(tiktokUser.follower_count);
  }
  if (tiktokUser?.engagement_rate) {
    engagementRates.push(tiktokUser.engagement_rate);
  }

  const totalFollowerCount = followerCounts.length > 0 ? followerCounts.reduce((acc, val) => acc + val, 0) : 0;

  const averageEngagementRate =
    engagementRates.length > 0 ? engagementRates.reduce((acc, val) => acc + val, 0) / engagementRates.length : 0;

  return {
    totalFollowerCount,
    averageEngagementRate,
  };
};

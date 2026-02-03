import { PrismaClient } from '@prisma/client';
import { encryptToken } from '../src/helper/encrypt';
import axios from 'axios';

const prisma = new PrismaClient();

// Your token data from the successful auth
const tokenData = {
  access_token: 'act.zwIO2vmHVwOVrdqXMrKo7xuvgav6g6u7SA9WGEPLYeU8ySEM6BsQZJv62yuW!5572.va',
  expires_in: 86400,
  open_id: '-000HCRiW50kT3njxhgF9pdaXVLcx6aCGeGt',
  refresh_expires_in: 31536000,
  refresh_token: 'rft.ajfAgtW6U6aIotrENqergVjZwI3KMkNY9knnmY3cETeFxVuX6OTlqtHjDWcY!5576.va',
  scope: 'user.info.basic,video.list,user.info.profile,user.info.stats',
  token_type: 'Bearer',
};

/**
 * Refresh the TikTok access token using the refresh token
 */
async function refreshTikTokToken(refreshToken: string) {
  console.log('🔄 Refreshing TikTok access token...');

  try {
    const response = await axios.post(
      'https://open.tiktokapis.com/v2/oauth/token/',
      new URLSearchParams({
        client_key: process.env.TIKTOK_CLIENT_KEY!,
        client_secret: process.env.TIKTOK_CLIENT_SECRET!,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      },
    );

    console.log('✅ Token refreshed successfully');
    return response.data;
  } catch (error: any) {
    console.error('❌ Error refreshing token:', error.response?.data || error.message);
    throw error;
  }
}

async function connectTikTokUser(userId: string) {
  let currentAccessToken = tokenData.access_token;

  try {
    console.log(`🔄 Connecting TikTok account for user: ${userId}`);

    // Try to fetch user data from TikTok API
    console.log('📡 Fetching user data from TikTok API...');
    let userInfoResponse;

    try {
      userInfoResponse = await axios.get('https://open.tiktokapis.com/v2/user/info/', {
        params: {
          fields: 'open_id,union_id,display_name,avatar_url,following_count,follower_count,likes_count',
        },
        headers: { Authorization: `Bearer ${currentAccessToken}` },
      });
    } catch (error: any) {
      // If token is invalid, try to refresh it
      if (error.response?.status === 401 && error.response?.data?.error?.code === 'access_token_invalid') {
        console.log('⚠️  Access token expired, attempting to refresh...');

        const refreshedData = await refreshTikTokToken(tokenData.refresh_token);
        currentAccessToken = refreshedData.access_token;

        // Retry with new token
        userInfoResponse = await axios.get('https://open.tiktokapis.com/v2/user/info/', {
          params: {
            fields: 'open_id,union_id,display_name,username,avatar_url,following_count,follower_count,likes_count',
          },
          headers: { Authorization: `Bearer ${currentAccessToken}` },
        });

        // Update tokenData with refreshed tokens for later use
        tokenData.access_token = refreshedData.access_token;
        tokenData.refresh_token = refreshedData.refresh_token;
        tokenData.expires_in = refreshedData.expires_in;
      } else {
        throw error;
      }
    }

    const userData = userInfoResponse.data.data.user;
    console.log(`✅ Fetched data for: ${userData.display_name}`);

    // Fetch video data from TikTok API for analytics
    console.log('📡 Fetching video data from TikTok API...');
    const videoInfoResponse = await axios.post(
      'https://open.tiktokapis.com/v2/video/list/',
      { max_count: 20 },
      {
        params: {
          fields: 'id,like_count,comment_count,share_count,view_count',
        },
        headers: { Authorization: `Bearer ${currentAccessToken}`, 'Content-Type': 'application/json' },
      },
    );

    const videos = videoInfoResponse.data.data.videos || [];
    console.log(`✅ Fetched ${videos.length} videos`);

    // Calculate analytics from actual video data
    // TikTok Engagement Rate Formula: (Average Likes + Average Comments + Average Shares per post) / Followers × 100
    const totalLikes = videos.reduce((acc: number, video: any) => acc + (video.like_count || 0), 0);
    const totalComments = videos.reduce((acc: number, video: any) => acc + (video.comment_count || 0), 0);
    const totalShares = videos.reduce((acc: number, video: any) => acc + (video.share_count || 0), 0);
    const totalViews = videos.reduce((acc: number, video: any) => acc + (video.view_count || 0), 0);

    const averageLikes = videos.length > 0 ? totalLikes / videos.length : 0;
    const averageComments = videos.length > 0 ? totalComments / videos.length : 0;
    const averageShares = videos.length > 0 ? totalShares / videos.length : 0;

    // Encrypt tokens (use the current token which may have been refreshed)
    const encryptedAccessToken = encryptToken(currentAccessToken);
    const encryptedRefreshToken = encryptToken(tokenData.refresh_token);

    console.log('🔐 Tokens encrypted successfully');

    // Calculate analytics
    const follower_count = userData.follower_count || 0;

    // Engagement Rate by Followers (Industry Standard for TikTok)
    // Formula: (Average Likes + Average Comments + Average Shares) / Followers × 100
    const engagement_rate = follower_count
      ? ((averageLikes + averageComments + averageShares) / follower_count) * 100
      : 0;

    console.log('\n📊 Engagement Metrics:');
    console.log(`   Average Likes: ${averageLikes.toFixed(2)}`);
    console.log(`   Average Comments: ${averageComments.toFixed(2)}`);
    console.log(`   Average Shares: ${averageShares.toFixed(2)}`);
    console.log(`   Total Videos Analyzed: ${videos.length}`);

    // Update creator record
    const creator = await prisma.creator.update({
      where: { userId: userId },
      data: {
        tiktokData: {
          ...tokenData,
          access_token: encryptedAccessToken,
          refresh_token: encryptedRefreshToken,
        },
        isTiktokConnected: true,
      },
      include: { tiktokUser: true },
    });

    console.log('✅ Creator record updated');

    // Create/update TikTok user record with analytics
    await prisma.tiktokUser.upsert({
      where: { creatorId: creator.id },
      update: {
        display_name: userData.display_name,
        username: userData.username,
        avatar_url: userData.avatar_url,
        following_count: userData.following_count,
        follower_count: userData.follower_count,
        likes_count: userData.likes_count,
        totalLikes: totalLikes,
        totalComments: totalComments,
        totalShares: totalShares,
        averageLikes: averageLikes,
        averageComments: averageComments,
        averageShares: averageShares,
        engagement_rate: engagement_rate,
        lastUpdated: new Date(),
      } as any,
      create: {
        creatorId: creator.id,
        display_name: userData.display_name,
        username: userData.username,
        avatar_url: userData.avatar_url,
        following_count: userData.following_count,
        follower_count: userData.follower_count,
        likes_count: userData.likes_count,
        totalLikes: totalLikes,
        totalComments: totalComments,
        totalShares: totalShares,
        averageLikes: averageLikes,
        averageComments: averageComments,
        averageShares: averageShares,
        engagement_rate: engagement_rate,
        lastUpdated: new Date(),
      } as any,
    });

    console.log('💾 TikTok user data saved to database');

    // Final verification
    const finalCreator = await prisma.creator.findUnique({
      where: { userId: userId },
      include: {
        user: { select: { name: true, email: true } },
        tiktokUser: true,
      },
    });

    console.log('\n🎉 TikTok Account Successfully Connected!');
    console.log('═'.repeat(50));
    console.log(`👤 User: ${finalCreator?.user.name} (${finalCreator?.user.email})`);
    console.log(`📱 TikTok: ${finalCreator?.tiktokUser?.display_name}`);
    console.log(`📱 TikTok username: ${finalCreator?.tiktokUser?.username}`);
    console.log(`👥 Followers: ${finalCreator?.tiktokUser?.follower_count}`);
    console.log(`💖 Likes: ${finalCreator?.tiktokUser?.likes_count}`);
    console.log(`📊 Engagement Rate: ${engagement_rate.toFixed(2)}%`);
    console.log(`🔗 Connected: ${finalCreator?.isTiktokConnected ? 'Yes' : 'No'}`);
  } catch (error: any) {
    console.error('❌ Error connecting TikTok account:', error.message);
    if (error.response) {
      console.error('API Response Error:', {
        status: error.response.status,
        data: error.response.data,
      });
    }
    throw error;
  }
}

async function main() {
  // Your test user IDs
  const userIds = ['cmk3guf48001cpd3wewcvd0z3'];

  console.log('🎯 TikTok User Connection Script');
  console.log('================================\n');

  const testUserId = userIds[0];

  try {
    await connectTikTokUser(testUserId);
  } catch (error) {
    console.error('❌ Script failed:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

export { connectTikTokUser };

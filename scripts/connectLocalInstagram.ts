import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import { encryptToken } from '../src/helper/encrypt';
import dayjs from 'dayjs';

const prisma = new PrismaClient();

// Configuration - Replace ACCESS_TOKEN with your Instagram access token
const USER_ID = 'cmgac552s001ruu4lgip3w9xy';
const ACCESS_TOKEN =
  'IGAANcWAm6FBFBZAFBjcmlRaWRVMU5kRXdCLTBDNEJJQVpILXIyODdlU25ULUxkUWs5Y21tSEV6dXB6YWNjT0Q4bjBUSnNMcGlvVlpPZA1J5bnFkNWF2d3R6T0c3Y0ZAvRG9YUGtvTmFUd3lWa2xkSGxGNHp2OXdReVNqZAk11RlFEYwZDZD'; // Replace this with your access token

interface InstagramOverview {
  user_id: string;
  followers_count: number;
  follows_count: number;
  media_count: number;
  username: string;
}

interface InstagramMediaData {
  sortedVideos: any[];
  averageLikes: number;
  averageComments: number;
  totalComments: number;
  totalLikes: number;
}

export const getInstagramOverviewService = async (accessToken: string): Promise<InstagramOverview> => {
  try {
    const res = await axios.get('https://graph.instagram.com/v12.0/me', {
      params: {
        access_token: accessToken,
        fields: 'user_id,followers_count,follows_count,media_count,username',
      },
    });

    return res.data;
  } catch (error: any) {
    console.error('Error fetching Instagram overview:', error.response?.data || error.message);
    throw new Error(`Failed to fetch Instagram overview: ${error.response?.data?.error?.message || error.message}`);
  }
};

export const getAllMediaObject = async (
  accessToken: string,
  instaUserId: string,
  limit?: number,
  fields = [
    'id',
    'comments_count',
    'like_count',
    'media_type',
    'media_url',
    'thumbnail_url',
    'caption',
    'permalink',
    'shortcode',
    'timestamp',
  ],
): Promise<InstagramMediaData> => {
  try {
    const res = await axios.get(`https://graph.instagram.com/v12.0/me/media`, {
      params: {
        access_token: accessToken,
        fields: fields.toString(),
        ...(limit && { limit: limit }),
      },
    });

    const videos = res.data.data || [];

    if (videos.length === 0) {
      return {
        sortedVideos: [],
        averageLikes: 0,
        averageComments: 0,
        totalComments: 0,
        totalLikes: 0,
      };
    }

    const totalComments = videos.reduce((acc: any, cur: any) => acc + (cur.comments_count || 0), 0);
    const averageComments = totalComments / videos.length;

    const totalLikes = videos.reduce((acc: any, cur: any) => acc + (cur.like_count || 0), 0);
    const averageLikes = totalLikes / videos.length;

    // Get top 5 posts
    const sortedVideos = videos.slice(0, 5);

    return { sortedVideos, averageLikes, averageComments, totalComments, totalLikes };
  } catch (error: any) {
    console.error('Error fetching Instagram media:', error.response?.data || error.message);
    throw new Error(`Failed to fetch Instagram media: ${error.response?.data?.error?.message || error.message}`);
  }
};

const main = async () => {
  try {
    console.log('\n🚀 Starting Instagram Account Connection');
    console.log('=====================================');

    // Step 1: Verify user exists and is a creator
    const user = await prisma.user.findUnique({
      where: { id: USER_ID },
      include: { creator: true },
    });

    if (!user) {
      throw new Error(`User with ID ${USER_ID} not found`);
    }

    if (!user.creator) {
      throw new Error(`User ${USER_ID} is not a creator. Please ensure the user has a creator profile.`);
    }

    console.log(`✓ User found: ${user.name || user.email}`);

    // Step 2: Fetch Instagram account overview
    console.log('\n📊 Fetching Instagram account overview...');
    const overview = await getInstagramOverviewService(ACCESS_TOKEN);

    console.log(`✓ Instagram account details:
    Username: @${overview.username}
    User ID: ${overview.user_id}
    Followers: ${overview.followers_count.toLocaleString()}
    Following: ${overview.follows_count.toLocaleString()}
    Media Count: ${overview.media_count}`);

    // Step 3: Encrypt the access token
    const encryptedAccessToken = encryptToken(ACCESS_TOKEN);
    console.log('\n✓ Access token encrypted');

    // Step 4: Calculate expiry timestamp (60 days from now)
    const expiryTimestamp = dayjs().add(60, 'days').unix();
    console.log(`✓ Token will expire on: ${dayjs.unix(expiryTimestamp).format('YYYY-MM-DD HH:mm:ss')}`);

    // Step 5: Create Instagram data structure
    const instagramData = {
      access_token: {
        value: encryptedAccessToken,
        expiresAt: dayjs().add(60, 'days').format(),
      },
    };

    // Step 6: Fetch media analytics
    console.log('\n📈 Fetching Instagram media analytics...');
    const medias = await getAllMediaObject(ACCESS_TOKEN, overview.user_id, overview.media_count);

    // Calculate proper analytics
    const totalLikes = medias.totalLikes || 0;
    const totalComments = medias.totalComments || 0;
    const averageLikes = medias.averageLikes || 0;
    const averageComments = medias.averageComments || 0;

    // Instagram Engagement Rate Formula: (Average Likes + Average Comments) / Followers × 100
    // Note: Instagram Graph API doesn't provide shares/saves data for third-party apps
    const engagement_rate = overview.followers_count
      ? ((averageLikes + averageComments) / overview.followers_count) * 100
      : 0;

    console.log(`✓ Media analytics:
    Total Likes: ${totalLikes.toLocaleString()}
    Total Comments: ${totalComments.toLocaleString()}
    Average Likes: ${averageLikes.toFixed(2)}
    Average Comments: ${averageComments.toFixed(2)}
    Engagement Rate: ${engagement_rate.toFixed(2)}%`);

    // Step 7: Generate unique test user_id
    const uniqueTestUserId = `test_${overview.user_id}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    console.log(`\n📝 Using unique test user_id: ${uniqueTestUserId}`);

    await prisma.$transaction(async (tx) => {
      if (!user.creator) {
        throw new Error('Creator profile not found');
      }

      // Update creator with Instagram data
      await tx.creator.update({
        where: { userId: USER_ID },
        data: {
          instagramData: instagramData,
          isFacebookConnected: true,
        },
      });

      // Create or update MediaKit
      await tx.mediaKit.upsert({
        where: { creatorId: user.creator.id },
        update: {
          displayName: overview.username,
          about: `Content creator with ${overview.followers_count.toLocaleString()} followers on Instagram. Average engagement: ${medias.averageLikes.toFixed(0)} likes per post.`,
        },
        create: {
          creatorId: user.creator.id,
          displayName: overview.username,
          about: `Content creator with ${overview.followers_count.toLocaleString()} followers on Instagram. Average engagement: ${medias.averageLikes.toFixed(0)} likes per post.`,
        },
      });

      // Update or create Instagram user record
      await tx.instagramUser.upsert({
        where: { creatorId: user.creator.id },
        update: {
          accessToken: instagramData.access_token.value,
          expiresIn: expiryTimestamp,
          user_id: uniqueTestUserId,
          followers_count: overview.followers_count,
          follows_count: overview.follows_count,
          media_count: overview.media_count,
          username: overview.username,
          totalLikes: totalLikes,
          totalComments: totalComments,
          averageLikes: averageLikes,
          averageComments: averageComments,
          engagement_rate: engagement_rate,
          lastUpdated: new Date(),
        },
        create: {
          creatorId: user.creator.id,
          accessToken: instagramData.access_token.value,
          expiresIn: expiryTimestamp,
          user_id: uniqueTestUserId,
          followers_count: overview.followers_count,
          follows_count: overview.follows_count,
          media_count: overview.media_count,
          username: overview.username,
          totalLikes: totalLikes,
          totalComments: totalComments,
          averageLikes: averageLikes,
          averageComments: averageComments,
          engagement_rate: engagement_rate,
          lastUpdated: new Date(),
        },
      });
    });

    console.log('\n✅ Instagram account connection completed successfully!');
    console.log('✅ MediaKit created/updated successfully!');

    // Final summary
    console.log('\n🎉 Connection Summary');
    console.log('==================');
    console.log(`User: ${user.name || user.email}`);
    console.log(`Instagram: @${overview.username}`);
    console.log(`Real Instagram User ID: ${overview.user_id}`);
    console.log(`Test User ID: ${uniqueTestUserId}`);
    console.log(`Followers: ${overview.followers_count.toLocaleString()}`);
    console.log(`Media Count: ${overview.media_count}`);
    console.log(`Average Likes: ${medias.averageLikes.toFixed(1)}`);
    console.log(`Average Comments: ${medias.averageComments.toFixed(1)}`);
    console.log(`Token Expiry: ${dayjs.unix(expiryTimestamp).format('YYYY-MM-DD HH:mm:ss')}`);
    console.log(`Connection Status: Connected ✅`);
    console.log(`MediaKit Status: Created/Updated ✅`);
  } catch (error: any) {
    console.error('\n❌ Error connecting Instagram account:', error.message);
    if (error.response?.data) {
      console.error('API Error Details:', error.response.data);
    }
    throw error;
  } finally {
    await prisma.$disconnect();
  }
};

// Run the script
main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

import { PrismaClient } from '@prisma/client';
import { encryptToken } from '../src/helper/encrypt';

const prisma = new PrismaClient();

// Your token data from the successful auth
const tokenData = {
  access_token: "act.zwIO2vmHVwOVrdqXMrKo7xuvgav6g6u7SA9WGEPLYeU8ySEM6BsQZJv62yuW!5572.va",
  expires_in: 86400,
  open_id: "-000HCRiW50kT3njxhgF9pdaXVLcx6aCGeGt",
  refresh_expires_in: 31536000,
  refresh_token: "rft.ajfAgtW6U6aIotrENqergVjZwI3KMkNY9knnmY3cETeFxVuX6OTlqtHjDWcY!5576.va",
  scope: "user.info.basic,video.list,user.info.profile,user.info.stats",
  token_type: "Bearer"
};

// Your user data from the API
const userData = {
  open_id: "-000HCRiW50kT3njxhgF9pdaXVLcx6aCGeGt",
  union_id: "9c31b70e-6d64-5178-8c3d-b6b8d9cc264d",
  avatar_url: "https://p16-sign-sg.tiktokcdn.com/tos-alisg-avt-0068/fc2fabb4861df36417191839dfcaa746~tplv-tiktokx-cropcenter:168:168.jpeg?dr=14577&refresh_token=a739bd9a&x-expires=1749718800&x-signature=m5pYoW5GmX8RzlOOGUYI4g1NIIQ%3D&t=4d5b0474&ps=13740610&shp=a5d48078&shcp=8aecc5ac&idc=maliva",
  display_name: "cultcreativeasia",
  follower_count: 7004,
  following_count: 45,
  likes_count: 73018
};

async function connectTikTokUser(userId: string) {
  try {
    console.log(`🔄 Connecting TikTok account for user: ${userId}`);

    // Encrypt tokens
    const encryptedAccessToken = encryptToken(tokenData.access_token);
    const encryptedRefreshToken = encryptToken(tokenData.refresh_token);

    console.log('🔐 Tokens encrypted successfully');

    // Calculate analytics
    const follower_count = userData.follower_count || 0;
    const likes_count = userData.likes_count || 0;
    const averageComments = 0; // This should be fetched from TikTok API if available
    const engagement_rate = follower_count 
      ? ((likes_count + averageComments) / follower_count) * 100 
      : 0;

    // Update creator record
    const creator = await prisma.creator.update({
      where: { userId: userId },
      data: {
        tiktokData: {
          ...tokenData,
          access_token: encryptedAccessToken,
          refresh_token: encryptedRefreshToken
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
        avatar_url: userData.avatar_url,
        following_count: userData.following_count,
        follower_count: userData.follower_count,
        likes_count: userData.likes_count,
        averageComments: averageComments,
        lastUpdated: new Date(),
      },
      create: {
        creatorId: creator.id,
        display_name: userData.display_name,
        avatar_url: userData.avatar_url,
        following_count: userData.following_count,
        follower_count: userData.follower_count,
        likes_count: userData.likes_count,
        averageComments: averageComments,
        lastUpdated: new Date(),
      },
    });

    console.log('💾 TikTok user data saved to database');

    // Final verification
    const finalCreator = await prisma.creator.findUnique({
      where: { userId: userId },
      include: {
        user: { select: { name: true, email: true } },
        tiktokUser: true
      }
    });

    console.log('\n🎉 TikTok Account Successfully Connected!');
    console.log('═'.repeat(50));
    console.log(`👤 User: ${finalCreator?.user.name} (${finalCreator?.user.email})`);
    console.log(`📱 TikTok: ${finalCreator?.tiktokUser?.display_name}`);
    console.log(`👥 Followers: ${finalCreator?.tiktokUser?.follower_count}`);
    console.log(`💖 Likes: ${finalCreator?.tiktokUser?.likes_count}`);
    console.log(`📊 Engagement Rate: ${engagement_rate.toFixed(2)}%`);
    console.log(`🔗 Connected: ${finalCreator?.isTiktokConnected ? 'Yes' : 'No'}`);

  } catch (error) {
    console.error('❌ Error connecting TikTok account:', error.message);
    throw error;
  }
}

async function main() {
  // Your test user IDs
  const userIds = [
    'cmbyk1e4t0000mrq8k0ykd3lw',
  ];

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
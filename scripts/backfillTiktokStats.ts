import { PrismaClient } from '@prisma/client';
import { ensureValidTikTokToken } from '../src/controller/socialController';
import {
  getTikTokMediaObject,
  getTikTokEngagementRateOverTime,
  getTikTokMonthlyInteractions,
} from '../src/service/socialMediaService';

const prisma = new PrismaClient();

/**
 * BACKFILL: TikTok engagement stats + trend charts for accounts connected
 * before the redirectTiktokAfterAuth fix, which previously never computed
 * totalLikes/averageLikes/.../engagement_rate (shown as 0 in the app) nor
 * analyticsData (page 3 trend charts, shown as mock data in the app).
 *
 * Only touches creators with isTiktokConnected=true and either field still
 * null, so already-healthy rows are left untouched. Uses a 6-month window
 * for analyticsData, matching the mobile app (web stays at its default 3).
 *
 * Run with: ts-node scripts/backfillTiktokStats.ts
 */

const DELAY_MS = 500; // spacing between TikTok API calls to stay under rate limits

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log('\n' + '='.repeat(80));
  console.log('🎵 TIKTOK STATS BACKFILL');
  console.log('='.repeat(80) + '\n');

  const creators = await prisma.creator.findMany({
    where: {
      isTiktokConnected: true,
      OR: [{ tiktokUser: { averageLikes: null } }, { tiktokUser: { analyticsData: { equals: null as any } } }],
    },
    select: { id: true, userId: true },
  });

  console.log(`Found ${creators.length} connected TikTok creator(s) with missing stats.\n`);

  let success = 0;
  let failed = 0;

  for (const creator of creators) {
    try {
      const accessToken = await ensureValidTikTokToken(creator.userId);
      const mediaObject = await getTikTokMediaObject(accessToken, 20);

      const engagement_rate = mediaObject.totalViews
        ? ((mediaObject.totalLikes + mediaObject.totalComments + mediaObject.totalShares) / mediaObject.totalViews) *
          100
        : 0;

      let analyticsData: {
        engagementRates: number[];
        months: string[];
        monthlyInteractions: { month: string; interactions: number }[];
      } | null = null;
      try {
        const [engagementAnalytics, monthlyAnalytics] = await Promise.all([
          getTikTokEngagementRateOverTime(accessToken, 20, 6),
          getTikTokMonthlyInteractions(accessToken, 20, 6),
        ]);
        analyticsData = {
          engagementRates: engagementAnalytics.engagementRates,
          months: engagementAnalytics.months,
          monthlyInteractions: monthlyAnalytics.monthlyData,
        };
      } catch (analyticsError: any) {
        console.error(`   trend analytics fetch failed for ${creator.userId}: ${analyticsError.message}`);
      }

      await prisma.tiktokUser.update({
        where: { creatorId: creator.id },
        data: {
          totalLikes: mediaObject.totalLikes,
          totalComments: mediaObject.totalComments,
          totalShares: mediaObject.totalShares,
          averageLikes: mediaObject.averageLikes,
          averageComments: mediaObject.averageComments,
          averageShares: mediaObject.averageShares,
          engagement_rate,
          ...(analyticsData ? { analyticsData } : {}),
          lastUpdated: new Date(),
        } as any,
      });

      console.log(`✅ ${creator.userId}: engagement_rate=${engagement_rate.toFixed(2)}%, analyticsData=${!!analyticsData}`);
      success++;
    } catch (error: any) {
      console.error(`❌ ${creator.userId}: ${error.message}`);
      failed++;
    }

    await sleep(DELAY_MS);
  }

  console.log('\n' + '='.repeat(80));
  console.log(`✨ DONE — success: ${success}, failed: ${failed}`);
  console.log('='.repeat(80) + '\n');
}

main()
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

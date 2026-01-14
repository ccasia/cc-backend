// @ts-nocheck
import { backfillAllSubmissionUrls, getCampaignSubmissionUrls } from '../src/service/submissionUrlService';
import { batchFetchInsights } from '../src/service/socialMediaBatchService';
import {
  calculateDailyMetrics,
  storeInsightSnapshot,
  NormalizedInsight,
} from '../src/service/trendAnalysisService';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * TEST BACKFILL SCRIPT
 * Populates SubmissionPostingUrl and InsightSnapshot tables with existing data
 * Run with: ts-node scripts/backfillCampaignInsights.ts [campaignId]
 */

async function main() {
  console.log('\n' + '='.repeat(80));
  console.log('🚀 CAMPAIGN INSIGHTS BACKFILL - TEST SCRIPT');
  console.log('='.repeat(80) + '\n');

  const campaignId = process.argv[2]; // Optional: specific campaign ID

  if (campaignId) {
    console.log(`🎯 Target campaign: ${campaignId}\n`);
  } else {
    console.log(`🌍 Mode: ALL campaigns with posted submissions\n`);
  }

  try {
    // ===== STEP 1: Backfill URLs from existing submissions =====
    console.log('📝 STEP 1: Extracting URLs from existing submissions');
    console.log('-'.repeat(80));

    const urlStats = await backfillAllSubmissionUrls(campaignId);

    console.log('\n📊 URL Extraction Summary:');
    console.log(`   Submissions processed: ${urlStats.processed}/${urlStats.total}`);
    console.log(`   ✅ URLs stored: ${urlStats.success}`);
    console.log(`   ⚠️  Invalid URLs: ${urlStats.invalid}`);
    console.log(`   ❌ Failed: ${urlStats.failed}`);

    if (urlStats.success === 0) {
      console.log('\n⚠️  No valid URLs found. Exiting.');
      process.exit(0);
    }

    // ===== STEP 2: Get campaigns with posting URLs =====
    console.log('\n\n📁 STEP 2: Identifying campaigns with posting URLs');
    console.log('-'.repeat(80));

    const campaignsWithUrls = await prisma.submissionPostingUrl.groupBy({
      by: ['campaignId'],
      where: campaignId ? { campaignId } : undefined,
      _count: {
        id: true,
      },
    });

    console.log(`\n📊 Found ${campaignsWithUrls.length} campaign(s) with posting URLs:`);
    for (const camp of campaignsWithUrls) {
      const campaign = await prisma.campaign.findUnique({
        where: { id: camp.campaignId },
        select: { name: true, status: true },
      });
      console.log(`   - ${campaign?.name} (${camp._count.id} URLs, status: ${campaign?.status})`);
    }

    // ===== STEP 3: Fetch insights for each campaign =====
    console.log('\n\n🔍 STEP 3: Fetching insights from Instagram/TikTok APIs');
    console.log('-'.repeat(80));

    for (const campData of campaignsWithUrls) {
      await processCampaignInsights(campData.campaignId);
    }

    // ===== STEP 4: Display summary =====
    console.log('\n\n📊 STEP 4: Backfill Summary');
    console.log('='.repeat(80));

    const totalSnapshots = await prisma.insightSnapshot.count();
    const snapshotsByPlatform = await prisma.insightSnapshot.groupBy({
      by: ['platform'],
      _count: { id: true },
    });

    console.log(`\n✅ Total snapshots created: ${totalSnapshots}`);
    for (const snap of snapshotsByPlatform) {
      console.log(`   - ${snap.platform}: ${snap._count.id} snapshot(s)`);
    }

    // Display sample snapshots
    console.log('\n📸 Sample snapshots:');
    const sampleSnapshots = await prisma.insightSnapshot.findMany({
      take: 3,
      orderBy: { createdAt: 'desc' },
      include: {
        campaign: {
          select: { name: true },
        },
      },
    });

    for (const snap of sampleSnapshots) {
      console.log(`\n   Campaign: ${snap.campaign.name}`);
      console.log(`   Platform: ${snap.platform}`);
      console.log(`   Date: ${snap.snapshotDate.toISOString().split('T')[0]}`);
      console.log(`   Posts: ${snap.totalPosts}`);
      console.log(`   Views: ${snap.totalViews.toLocaleString()}`);
      console.log(`   Engagement Rate: ${snap.averageEngagementRate.toFixed(2)}%`);
      console.log(`   Top Creator: ${(snap.topCreatorsByViews as any)?.[0]?.userName || 'N/A'}`);
    }

    console.log('\n' + '='.repeat(80));
    console.log('✨ BACKFILL COMPLETE - Ready for frontend testing!');
    console.log('='.repeat(80) + '\n');
  } catch (error: any) {
    console.error('\n' + '='.repeat(80));
    console.error('❌ BACKFILL FAILED');
    console.error('='.repeat(80));
    console.error(`Error: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

/**
 * Process insights for a single campaign
 */
async function processCampaignInsights(campaignId: string): Promise<void> {
  console.log(`\n🎯 Processing campaign: ${campaignId}`);

  try {
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { name: true },
    });

    console.log(`   Campaign: ${campaign?.name || 'Unknown'}`);

    // Fetch URLs for both platforms
    const instaUrls = await getCampaignSubmissionUrls(campaignId, 'Instagram');
    const tiktokUrls = await getCampaignSubmissionUrls(campaignId, 'TikTok');

    console.log(`   📊 URLs: ${instaUrls.length} Instagram, ${tiktokUrls.length} TikTok`);

    if (instaUrls.length === 0 && tiktokUrls.length === 0) {
      console.log(`   ⚠️  No posting URLs found, skipping...`);
      return;
    }

    // Process Instagram insights
    if (instaUrls.length > 0) {
      console.log(`\n   📱 Fetching Instagram insights...`);
      await processPlatformInsights(campaignId, 'Instagram', instaUrls);
    }

    // Process TikTok insights
    if (tiktokUrls.length > 0) {
      console.log(`\n   🎵 Fetching TikTok insights...`);
      await processPlatformInsights(campaignId, 'TikTok', tiktokUrls);
    }

    console.log(`\n   ✅ Campaign ${campaignId} complete`);
  } catch (error: any) {
    console.error(`\n   ❌ Error processing campaign ${campaignId}:`, error.message);
  }
}

/**
 * Process insights for a specific platform
 * Creates snapshots for the past 7 days with simulated metric variations
 */
async function processPlatformInsights(
  campaignId: string,
  platform: 'Instagram' | 'TikTok',
  urls: any[]
): Promise<void> {
  try {
    // Prepare batch requests
    const requests = urls.map((url) => ({
      mediaId: url.mediaId || undefined,
      shortCode: url.shortCode || undefined,
      userId: url.submission.userId,
      campaignId,
    }));

    console.log(`      📦 Batching ${requests.length} ${platform} requests...`);

    // Fetch insights (we'll use these as base values)
    const results = await batchFetchInsights({
      platform,
      requests,
      batchSize: 3,
      delayMs: 200,
    });

    // Filter valid results
    const validResults = results.filter((r) => !r.error);
    console.log(`      ✅ Successfully fetched: ${validResults.length}/${results.length}`);

    if (validResults.length === 0) {
      console.log(`      ⚠️  No valid insights, skipping snapshot...`);
      return;
    }

    // Get base normalized insights from API
    const baseInsights: NormalizedInsight[] = validResults.map((result) => {
      const url = urls.find((u) => u.submission.userId === result.userId);
      const metrics = result.insight.metrics;

      return {
        userId: result.userId,
        userName: url?.submission.user.name || 'Unknown',
        postUrl: url?.postUrl || '',
        postingDate: url?.postingDate || new Date(),
        views: getMetricValue(metrics, ['views', 'plays', 'view_count']),
        likes: getMetricValue(metrics, ['likes', 'like_count']),
        comments: getMetricValue(metrics, ['comments', 'comment_count']),
        shares: getMetricValue(metrics, ['shares', 'share_count']),
        saved: platform === 'Instagram' ? getMetricValue(metrics, ['saved']) : undefined,
        reach: platform === 'Instagram' ? getMetricValue(metrics, ['reach']) : undefined,
      };
    });

    console.log(`      📊 Base insights: ${baseInsights.length}`);

    // Create snapshots for the past 7 days
    const DAYS_TO_BACKFILL = 7;
    console.log(`      📅 Creating ${DAYS_TO_BACKFILL} daily snapshots...`);

    for (let daysAgo = DAYS_TO_BACKFILL - 1; daysAgo >= 0; daysAgo--) {
      const snapshotDate = new Date();
      snapshotDate.setDate(snapshotDate.getDate() - daysAgo);
      snapshotDate.setHours(10, 0, 0, 0); // Normalize to 10 AM

      // Apply variation multipliers to simulate growth over time
      // Day 0 (oldest) = ~60% of current, Day 6 (today) = 100%
      const growthFactor = 0.6 + (0.4 * (DAYS_TO_BACKFILL - 1 - daysAgo) / (DAYS_TO_BACKFILL - 1));
      
      // Add some daily randomness (±15%)
      const dailyVariation = 0.85 + Math.random() * 0.3;
      const multiplier = growthFactor * dailyVariation;

      // Create varied insights for this day
      const variedInsights: NormalizedInsight[] = baseInsights.map((insight) => ({
        ...insight,
        views: Math.round(insight.views * multiplier),
        likes: Math.round(insight.likes * multiplier),
        comments: Math.round(insight.comments * multiplier),
        shares: Math.round(insight.shares * multiplier),
        saved: insight.saved ? Math.round(insight.saved * multiplier) : undefined,
        reach: insight.reach ? Math.round(insight.reach * multiplier) : undefined,
      }));

      // Calculate metrics for this day
      const metrics = await calculateDailyMetrics(campaignId, platform, variedInsights);

      // Store snapshot with the backdated date
      await storeInsightSnapshot(campaignId, metrics, snapshotDate);

      const dateStr = snapshotDate.toISOString().split('T')[0];
      console.log(`         📸 Day ${DAYS_TO_BACKFILL - daysAgo}/7: ${dateStr} (multiplier: ${multiplier.toFixed(2)})`);
    }

    console.log(`      💾 ${DAYS_TO_BACKFILL} snapshots stored for ${platform}`);
  } catch (error: any) {
    console.error(`      ❌ Error processing ${platform} insights:`, error.message);
  }
}

/**
 * Helper to extract metric value from various formats
 */
function getMetricValue(metrics: any, possibleKeys: string[]): number {
  if (!metrics) return 0;


  // If metrics is an array (Instagram format)
  if (Array.isArray(metrics)) {
    for (const key of possibleKeys) {
      const metric = metrics.find((m: any) => m.name === key);
      // Support both { name, value } and { name, values: [{ value }] }
      if (metric) {
        if (typeof metric.value === 'number') {
          return metric.value;
        }
        if (metric.values?.[0]?.value !== undefined) {
          return metric.values[0].value;
        }
      }
    }
  }

  // If metrics is an object (TikTok format or normalized)
  for (const key of possibleKeys) {
    if (metrics[key] !== undefined) {
      return metrics[key];
    }
  }

  return 0;
}

// Run the script
main()
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

import { PrismaClient } from '@prisma/client';
import { batchFetchInsights } from '@services/socialMediaBatchService';
import { calculateDailyMetrics, storeInsightSnapshot } from '@services/trendAnalysisService';
import { getCampaignSubmissionUrls, extractAndStoreSubmissionUrls } from '@services/submissionUrlService';
import { normalizeInsightResults, UrlData } from '@utils/insightNormalizationHelper';

const prisma = new PrismaClient();

/**
 * Initial fetch delay - wait 2 hours for post to accumulate engagement
 * Can be configured based on requirements
 */
const INITIAL_FETCH_DELAY_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Map to track scheduled fetches (prevents duplicates)
 */
const scheduledFetches = new Map<string, NodeJS.Timeout>();

/**
 * Schedule initial insight fetch for newly posted URLs
 * Delays fetch by 2 hours to let post accumulate engagement
 *
 * @param campaignId - Campaign ID
 * @param submissionId - Submission ID (for tracking)
 */
export async function scheduleInitialInsightFetch(
  campaignId: string,
  submissionId: string
): Promise<void> {
  const fetchKey = `${campaignId}_${submissionId}`;

  // Cancel any existing scheduled fetch for this submission
  if (scheduledFetches.has(fetchKey)) {
    clearTimeout(scheduledFetches.get(fetchKey));
    console.log(`🔄 Cancelled previous scheduled fetch for ${fetchKey}`);
  }

  console.log(`⏰ Scheduling initial insight fetch for campaign ${campaignId} in 2 hours...`);

  const timeoutId = setTimeout(async () => {
    console.log(`🔍 Running scheduled initial insight fetch for campaign ${campaignId}...`);

    try {
      await fetchAndStoreInsightsForCampaign(campaignId);
      console.log(`✅ Initial insight fetch complete for campaign ${campaignId}`);
    } catch (error: any) {
      console.error(`❌ Initial insight fetch failed for campaign ${campaignId}:`, error.message);
    } finally {
      // Clean up tracking map
      scheduledFetches.delete(fetchKey);
    }
  }, INITIAL_FETCH_DELAY_MS);

  scheduledFetches.set(fetchKey, timeoutId);
}

/**
 * Immediately fetch insights for a campaign (used by cronjob and manual triggers)
 *
 * @param campaignId - Campaign ID to fetch insights for
 */
export async function fetchAndStoreInsightsForCampaign(campaignId: string): Promise<void> {
  console.log(`🔍 Fetching insights for campaign ${campaignId}...`);

  try {
    // Get campaign info for logging
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { name: true, status: true },
    });

    if (!campaign) {
      console.warn(`⚠️  Campaign ${campaignId} not found`);
      return;
    }

    console.log(`📊 Campaign: ${campaign.name} (${campaign.status})`);

    // STEP 1: Backfill URLs from Submission.content for any submissions that don't have URLs yet
    console.log(`   🔄 Backfilling URLs from submission content...`);
    await backfillMissingSubmissionUrls(campaignId);

    // STEP 2: Fetch URLs for both platforms
    const instaUrls = await getCampaignSubmissionUrls(campaignId, 'Instagram');
    const tiktokUrls = await getCampaignSubmissionUrls(campaignId, 'TikTok');

    console.log(`   📱 Instagram URLs: ${instaUrls.length}`);
    console.log(`   🎵 TikTok URLs: ${tiktokUrls.length}`);

    if (instaUrls.length === 0 && tiktokUrls.length === 0) {
      console.log(`   ⚠️  No posting URLs found, skipping...`);
      return;
    }

    // Fetch and store Instagram insights
    if (instaUrls.length > 0) {
      await fetchAndStorePlatformInsights(campaignId, 'Instagram', instaUrls);
    }

    // Fetch and store TikTok insights
    if (tiktokUrls.length > 0) {
      await fetchAndStorePlatformInsights(campaignId, 'TikTok', tiktokUrls);
    }

    console.log(`✅ Insights fetched and stored for campaign ${campaignId}`);
  } catch (error: any) {
    console.error(`❌ Error fetching insights for campaign ${campaignId}:`, error.message);
    throw error;
  }
}

/**
 * Fetch and store insights for a specific platform
 */
async function fetchAndStorePlatformInsights(
  campaignId: string,
  platform: 'Instagram' | 'TikTok',
  urls: any[]
): Promise<void> {
  console.log(`\n   📦 Fetching ${platform} insights...`);

  try {
    // Prepare batch requests
    const requests = urls.map((url) => ({
      mediaId: url.mediaId || undefined,
      shortCode: url.shortCode || undefined,
      userId: url.submission.userId,
      campaignId,
    }));

    // Fetch insights using batch service
    const results = await batchFetchInsights({
      platform,
      requests,
      batchSize: 3,
      delayMs: 200,
    });

    // Filter valid results
    const validResults = results.filter((r) => !r.error);
    console.log(`   ✅ Successfully fetched: ${validResults.length}/${results.length}`);

    if (validResults.length === 0) {
      console.log(`   ⚠️  No valid insights for ${platform}, skipping snapshot...`);
      return;
    }

    // Normalize insights using the helper
    const urlData: UrlData[] = urls.map((url) => ({
      postUrl: url.postUrl,
      postingDate: url.postingDate,
      submission: {
        userId: url.submission.userId,
        user: {
          id: url.submission.user.id,
          name: url.submission.user.name,
        },
      },
    }));

    const normalizedInsights = normalizeInsightResults(results, urlData, platform);

    if (normalizedInsights.length === 0) {
      console.log(`   ⚠️  No normalized insights for ${platform}, skipping snapshot...`);
      return;
    }

    // Calculate metrics
    const metrics = await calculateDailyMetrics(campaignId, platform, normalizedInsights);

    // Store snapshot
    await storeInsightSnapshot(campaignId, metrics, new Date());

    console.log(`   💾 Snapshot stored for ${platform}`);
  } catch (error: any) {
    console.error(`   ❌ Error processing ${platform} insights:`, error.message);
    throw error;
  }
}

/**
 * Fetch insights for all active campaigns (used by daily cronjob)
 */
export async function fetchInsightsForAllCampaigns(): Promise<{
  processed: number;
  success: number;
  failed: number;
}> {
  console.log('\n' + '='.repeat(80));
  console.log('🔄 DAILY INSIGHT SNAPSHOT COLLECTION');
  console.log('='.repeat(80) + '\n');

  const stats = {
    processed: 0,
    success: 0,
    failed: 0,
  };

  try {
    // Get all campaigns with POSTED or APPROVED submissions (either with URLs or with content to backfill)
    const campaignIds = await prisma.submission.findMany({
      where: {
        status: { in: ['POSTED', 'APPROVED'] },
        content: { not: null },
      },
      select: {
        campaignId: true,
      },
      distinct: ['campaignId'],
    });

    console.log(`📊 Found ${campaignIds.length} campaign(s) with POSTED/APPROVED submissions\n`);

    if (campaignIds.length === 0) {
      console.log(`   ℹ️  No POSTED/APPROVED submissions found`);
      return stats;
    }

    for (const campaign of campaignIds) {
      stats.processed++;

      try {
        await fetchAndStoreInsightsForCampaign(campaign.campaignId);
        stats.success++;
      } catch (error: any) {
        console.error(`❌ Failed to process campaign ${campaign.campaignId}:`, error.message);
        stats.failed++;
      }

      // Small delay between campaigns to avoid API rate limits
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    console.log('\n' + '='.repeat(80));
    console.log('📊 DAILY SNAPSHOT SUMMARY');
    console.log('='.repeat(80));
    console.log(`   Campaigns processed: ${stats.processed}`);
    console.log(`   ✅ Success: ${stats.success}`);
    console.log(`   ❌ Failed: ${stats.failed}`);
    console.log('='.repeat(80) + '\n');

    return stats;
  } catch (error: any) {
    console.error('❌ Fatal error in daily insight collection:', error.message);
    throw error;
  }
}

/**
 * Cancel a scheduled fetch (used when submission is updated before fetch runs)
 */
export function cancelScheduledFetch(campaignId: string, submissionId: string): void {
  const fetchKey = `${campaignId}_${submissionId}`;

  if (scheduledFetches.has(fetchKey)) {
    clearTimeout(scheduledFetches.get(fetchKey));
    scheduledFetches.delete(fetchKey);
    console.log(`🚫 Cancelled scheduled fetch for ${fetchKey}`);
  }
}

/**
 * Get count of pending scheduled fetches (for monitoring)
 */
export function getPendingFetchCount(): number {
  return scheduledFetches.size;
}

/**
 * Backfill: Extract and store URLs from Submission.content for submissions that don't have them yet
 * This ensures old submissions and submissions that bypass the normal flow get indexed
 *
 * @param campaignId - Campaign ID to backfill
 */
async function backfillMissingSubmissionUrls(campaignId: string): Promise<void> {
  try {
    // Find all POSTED or APPROVED submissions in this campaign
    const submissions = await prisma.submission.findMany({
      where: {
        campaignId,
        status: { in: ['POSTED', 'APPROVED'] },
        content: { not: null }, // Has content
      },
      select: {
        id: true,
        content: true,
      },
    });

    if (submissions.length === 0) {
      console.log(`   ℹ️  No POSTED/APPROVED submissions to backfill`);
      return;
    }

    console.log(`   🔄 Backfilling ${submissions.length} submission(s)...`);

    for (const submission of submissions) {
      try {
        // Check if this submission already has URLs extracted
        const existingUrls = await prisma.submissionPostingUrl.count({
          where: { submissionId: submission.id },
        });

        if (existingUrls > 0) {
          // Already extracted
          continue;
        }

        // Extract and store URLs from content
        if (submission.content) {
          await extractAndStoreSubmissionUrls(submission.id, submission.content);
        }
      } catch (error: any) {
        console.error(
          `   ⚠️  Failed to backfill URLs for submission ${submission.id}:`,
          error.message
        );
        // Continue with next submission
      }
    }

    console.log(`   ✅ Backfill complete`);
  } catch (error: any) {
    console.error(`   ❌ Error during backfill:`, error.message);
    // Don't throw - backfill failure shouldn't stop insight fetching
  }
}

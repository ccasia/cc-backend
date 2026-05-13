import { PrismaClient } from '@prisma/client';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { batchFetchInsights } from './socialMediaBatchService';
import { getMetricValue } from '@utils/insightNormalizationHelper';

dayjs.extend(utc);
dayjs.extend(timezone);

const prisma = new PrismaClient();

// Snapshot days from campaign start
const SNAPSHOT_DAYS = [7, 15, 30];

interface PostSnapshot {
  campaignId: string;
  submissionId: string;
  postUrl: string;
  platform: 'Instagram' | 'TikTok';
  userId: string;
  postDate: Date;
  snapshotDay: number;
  metrics: {
    views: number;
    likes: number;
    comments: number;
    shares: number;
    saved: number;
    reach: number;
    engagementRate: number;
  };
  rawMetrics: any;
}

/**
 * Main function to capture ER snapshots for all eligible posts
 * Called daily by cron job
 */
export async function capturePostEngagementSnapshots(): Promise<{
  processed: number;
  captured: number;
  skipped: number;
  failed: number;
}> {
  console.log('\n' + '='.repeat(80));
  console.log('POST ENGAGEMENT SNAPSHOT COLLECTION (Day 7, 15, 30)');
  console.log('='.repeat(80) + '\n');

  const stats = {
    processed: 0,
    captured: 0,
    skipped: 0,
    failed: 0,
  };

  try {
    // Get all active campaigns with their start dates
    const campaigns = await prisma.campaign.findMany({
      where: {
        status: { in: ['ACTIVE', 'COMPLETED'] },
        campaignBrief: {
          isNot: null,
        },
      },
      include: {
        campaignBrief: {
          select: {
            startDate: true,
            endDate: true,
          },
        },
        submissionPostingUrls: {
          where: {
            postingDate: { not: null },
          },
          include: {
            submission: {
              select: {
                userId: true,
                id: true,
              },
            },
          },
        },
      },
    });

    console.log(`Found ${campaigns.length} active/completed campaign(s)\n`);

    for (const campaign of campaigns) {
      if (!campaign.campaignBrief?.startDate) continue;

      const campaignStartDate = dayjs(campaign.campaignBrief.startDate).tz('Asia/Kuala_Lumpur');
      const today = dayjs().tz('Asia/Kuala_Lumpur');
      const daysFromStart = today.diff(campaignStartDate, 'day');

      console.log(`\n📋 Campaign: ${campaign.name}`);
      console.log(`   Start Date: ${campaignStartDate.format('YYYY-MM-DD')}`);
      console.log(`   Days from start: ${daysFromStart}`);
      console.log(`   Posts with URLs: ${campaign.submissionPostingUrls.length}`);

      // Check which snapshot day we should capture today
      const snapshotDayToCapture = SNAPSHOT_DAYS.find((day) => day === daysFromStart);

      if (!snapshotDayToCapture) {
        console.log(`   ⏭️  Not a snapshot day (need day 7, 15, or 30)`);
        continue;
      }

      console.log(`   🎯 Today is Day ${snapshotDayToCapture} - capturing snapshots!`);

      // Process each post in this campaign
      for (const postingUrl of campaign.submissionPostingUrls) {
        stats.processed++;

        try {
          const postDate = dayjs(postingUrl.postingDate!).tz('Asia/Kuala_Lumpur');
          const daysFromPostDate = today.diff(postDate, 'day');

          console.log(`\n      📍 Post: ${postingUrl.postUrl}`);
          console.log(`         Platform: ${postingUrl.platform}`);
          console.log(`         Posted: ${postDate.format('YYYY-MM-DD')}`);
          console.log(`         Days since post: ${daysFromPostDate}`);

          // Check if snapshot already exists
          const existingSnapshot = await prisma.postEngagementSnapshot.findUnique({
            where: {
              campaignId_postUrl_snapshotDay: {
                campaignId: campaign.id,
                postUrl: postingUrl.postUrl,
                snapshotDay: snapshotDayToCapture,
              },
            },
          });

          if (existingSnapshot) {
            console.log(`         ⏭️  Snapshot already exists for Day ${snapshotDayToCapture}`);
            stats.skipped++;
            continue;
          }

          // Fetch current insights for this post
          const snapshot = await capturePostSnapshot(campaign.id, postingUrl, snapshotDayToCapture);

          if (snapshot) {
            await storePostSnapshot(snapshot);
            console.log(
              `         ✅ Captured Day ${snapshotDayToCapture} snapshot: ER ${snapshot.metrics.engagementRate.toFixed(2)}%`,
            );
            stats.captured++;
          } else {
            console.log(`         ⚠️  Failed to fetch insights`);
            stats.failed++;
          }
        } catch (error: any) {
          console.error(`         ❌ Error processing post:`, error.message);
          stats.failed++;
        }

        // Small delay to avoid rate limits
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('📊 SNAPSHOT SUMMARY');
    console.log('='.repeat(80));
    console.log(`   Posts processed: ${stats.processed}`);
    console.log(`   ✅ Snapshots captured: ${stats.captured}`);
    console.log(`   ⏭️  Already exists: ${stats.skipped}`);
    console.log(`   ❌ Failed: ${stats.failed}`);
    console.log('='.repeat(80) + '\n');

    return stats;
  } catch (error: any) {
    console.error('❌ Fatal error in snapshot collection:', error.message);
    throw error;
  }
}

/**
 * Capture a single post's engagement snapshot
 */
async function capturePostSnapshot(
  campaignId: string,
  postingUrl: any,
  snapshotDay: number,
): Promise<PostSnapshot | null> {
  try {
    const platform = postingUrl.platform as 'Instagram' | 'TikTok';

    // Fetch insights using batch service
    const results = await batchFetchInsights({
      platform,
      requests: [
        {
          mediaId: postingUrl.mediaId || undefined,
          shortCode: postingUrl.shortCode || undefined,
          userId: postingUrl.submission.userId,
          campaignId,
        },
      ],
      batchSize: 1,
      delayMs: 0,
    });

    if (results.length === 0 || results[0].error) {
      console.error(`      ❌ Failed to fetch insights:`, results[0]?.error);
      return null;
    }

    const insight = results[0].insight;

    // Calculate engagement rate
    const metrics = extractMetrics(insight, platform);

    return {
      campaignId,
      submissionId: postingUrl.submissionId,
      postUrl: postingUrl.postUrl,
      platform,
      userId: postingUrl.submission.userId,
      postDate: postingUrl.postingDate!,
      snapshotDay,
      metrics,
      rawMetrics: insight,
    };
  } catch (error: any) {
    console.error(`      ❌ Error capturing snapshot:`, error.message);
    return null;
  }
}

/**
 * Extract and calculate metrics from a raw batchFetchInsights result.
 *
 * `insight` is the full result.insight object from socialMediaBatchService:
 *   - Instagram: { mediaId, shortCode, metrics: [{ name, value }, ...] }
 *   - TikTok:    { mediaId, metrics: { view_count, like_count, ... } }
 *
 * Reads through the shared `getMetricValue` helper (insightNormalizationHelper)
 * so this stays in sync with how the campaign-level pipeline parses metrics.
 *
 * Engagement-rate formula matches the per-creator math in calculateDailyMetrics:
 *   - Instagram: (likes + comments + shares + saved) / reach * 100, fallback to views
 *   - TikTok:    (likes + comments + shares) / views * 100
 */
function extractMetrics(
  insight: any,
  platform: 'Instagram' | 'TikTok',
): {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saved: number;
  reach: number;
  engagementRate: number;
} {
  const metrics = insight?.metrics;

  let views = getMetricValue(metrics, ['views', 'plays', 'view_count']);
  let likes = getMetricValue(metrics, ['likes', 'like_count']);
  let comments = getMetricValue(metrics, ['comments', 'comment_count']);
  let shares = getMetricValue(metrics, ['shares', 'share_count']);
  let saved = platform === 'Instagram' ? getMetricValue(metrics, ['saved']) : 0;
  let reach = platform === 'Instagram' ? getMetricValue(metrics, ['reach']) : views;

  let engagementRate = 0;
  if (platform === 'Instagram') {
    const denominator = reach > 0 ? reach : views;
    if (denominator > 0) {
      engagementRate = ((likes + comments + shares + saved) / denominator) * 100;
    }
  } else if (platform === 'TikTok') {
    // Extract from TikTok insight structure
    views = insight.video?.play_count || insight.video?.view_count || 0;
    likes = insight.video?.like_count || 0;
    comments = insight.video?.comment_count || 0;
    shares = insight.video?.share_count || 0;
    saved = 0;
    reach = views;
  }

  return {
    views,
    likes,
    comments,
    shares,
    saved,
    reach,
    engagementRate,
  };
}

/**
 * Store post snapshot in database
 */
async function storePostSnapshot(snapshot: PostSnapshot): Promise<void> {
  await prisma.postEngagementSnapshot.create({
    data: {
      campaignId: snapshot.campaignId,
      submissionId: snapshot.submissionId,
      postUrl: snapshot.postUrl,
      platform: snapshot.platform,
      userId: snapshot.userId,
      snapshotDay: snapshot.snapshotDay,
      postDate: snapshot.postDate,
      capturedAt: new Date(),
      views: snapshot.metrics.views,
      likes: snapshot.metrics.likes,
      comments: snapshot.metrics.comments,
      shares: snapshot.metrics.shares,
      saved: snapshot.metrics.saved,
      reach: snapshot.metrics.reach,
      engagementRate: snapshot.metrics.engagementRate,
      rawMetrics: snapshot.rawMetrics,
    },
  });
}

/**
 * Get post engagement snapshots for a campaign
 * Returns snapshots organized by submission and snapshot day
 */
export async function getPostEngagementSnapshots(campaignId: string): Promise<
  {
    submissionId: string;
    userId: string;
    postUrl: string;
    platform: string;
    postDate: Date;
    snapshots: {
      day7?: { er: number; views: number; likes: number; comments: number; shares: number };
      day15?: { er: number; views: number; likes: number; comments: number; shares: number };
      day30?: { er: number; views: number; likes: number; comments: number; shares: number };
    };
  }[]
> {
  const snapshots = await prisma.postEngagementSnapshot.findMany({
    where: { campaignId },
    orderBy: [{ submissionId: 'asc' }, { snapshotDay: 'asc' }],
  });

  // Group by submission
  const groupedBySubmission = new Map<
    string,
    {
      submissionId: string;
      userId: string;
      postUrl: string;
      platform: string;
      postDate: Date;
      snapshots: any;
    }
  >();

  for (const snapshot of snapshots) {
    const key = snapshot.submissionId;

    if (!groupedBySubmission.has(key)) {
      groupedBySubmission.set(key, {
        submissionId: snapshot.submissionId,
        userId: snapshot.userId,
        postUrl: snapshot.postUrl,
        platform: snapshot.platform,
        postDate: snapshot.postDate,
        snapshots: {},
      });
    }

    const group = groupedBySubmission.get(key)!;
    const dayKey = `day${snapshot.snapshotDay}` as 'day7' | 'day15' | 'day30';

    group.snapshots[dayKey] = {
      er: snapshot.engagementRate,
      views: snapshot.views,
      likes: snapshot.likes,
      comments: snapshot.comments,
      shares: snapshot.shares,
    };
  }

  return Array.from(groupedBySubmission.values());
}

// ============================================================================
// DAILY POST ENGAGEMENT SNAPSHOTS
// ----------------------------------------------------------------------------
// Below the milestone capture (Day 7/15/30 from campaign start), the following
// functions capture a *daily* snapshot per posting URL — anchored on the
// post's own publish date rather than the campaign start. This produces a
// continuous time series that powers per-post engagement-rate and views
// trend charts on the frontend. The 7/15/30 milestone behavior above is
// intentionally left untouched.
// ============================================================================

/**
 * Skip posts older than this many days from the daily capture pass.
 * Past this window, engagement on Instagram/TikTok rarely shifts, so it's
 * not worth burning the API quota. Adjust if you need longer trend windows.
 */
const DAILY_CAPTURE_MAX_AGE_DAYS = 90;

/**
 * Run the daily per-post engagement capture across every eligible posting URL
 * in every ACTIVE/COMPLETED campaign.
 *
 * For each posting URL:
 *  - Skips if the post date is in the future, or older than DAILY_CAPTURE_MAX_AGE_DAYS.
 *  - Fetches the latest insights via batchFetchInsights (grouped by platform).
 *  - Upserts a row in DailyPostEngagementSnapshot keyed on (postUrl, snapshotDate)
 *    so that re-running on the same calendar day is idempotent.
 *
 * Intended to be invoked once per day by the cron job, *after* the milestone
 * capture pass so they share the same rate-limit budget within one logical run.
 */
export async function captureDailyPostEngagement(): Promise<{
  processed: number;
  captured: number;
  skipped: number;
  failed: number;
}> {
  console.log('\n' + '='.repeat(80));
  console.log('DAILY POST ENGAGEMENT SNAPSHOT COLLECTION');
  console.log('='.repeat(80) + '\n');

  const stats = { processed: 0, captured: 0, skipped: 0, failed: 0 };
  const today = dayjs().tz('Asia/Kuala_Lumpur').startOf('day');

  try {
    const postingUrls = await prisma.submissionPostingUrl.findMany({
      where: {
        postingDate: { not: null },
        campaign: {
          status: { in: ['ACTIVE', 'COMPLETED'] },
        },
      },
      include: {
        submission: { select: { id: true, userId: true } },
      },
    });

    console.log(`Found ${postingUrls.length} posting URL(s) to evaluate\n`);

    // Bucket eligible URLs by platform so we can batch-fetch within each platform
    const eligibleByPlatform: Record<'Instagram' | 'TikTok', any[]> = {
      Instagram: [],
      TikTok: [],
    };

    for (const url of postingUrls) {
      const postDate = dayjs(url.postingDate!).tz('Asia/Kuala_Lumpur').startOf('day');
      const daysSincePost = today.diff(postDate, 'day');

      if (daysSincePost < 0) {
        stats.skipped++;
        continue; // post date in the future
      }
      if (daysSincePost > DAILY_CAPTURE_MAX_AGE_DAYS) {
        stats.skipped++;
        continue; // outside trend window
      }

      const platform = url.platform as 'Instagram' | 'TikTok';
      if (platform !== 'Instagram' && platform !== 'TikTok') {
        stats.skipped++;
        continue;
      }
      eligibleByPlatform[platform].push(url);
    }

    for (const platform of ['Instagram', 'TikTok'] as const) {
      const urls = eligibleByPlatform[platform];
      if (urls.length === 0) continue;

      console.log(`📦 ${platform}: ${urls.length} post(s)`);

      const requests = urls.map((url) => ({
        mediaId: url.mediaId || undefined,
        shortCode: url.shortCode || undefined,
        userId: url.submission.userId,
        campaignId: url.campaignId,
      }));

      const results = await batchFetchInsights({
        platform,
        requests,
        batchSize: 3,
        delayMs: 200,
      });

      for (let i = 0; i < urls.length; i++) {
        stats.processed++;
        const url = urls[i];
        const result = results[i];

        if (!result || result.error || !result.insight) {
          console.error(`   ❌ Fetch failed for ${url.postUrl}: ${result?.error ?? 'no result'}`);
          stats.failed++;
          continue;
        }

        try {
          const postDate = dayjs(url.postingDate!).tz('Asia/Kuala_Lumpur').startOf('day');
          const daysSincePost = today.diff(postDate, 'day');
          const metrics = extractMetrics(result.insight, platform);

          await prisma.dailyPostEngagementSnapshot.upsert({
            where: {
              postUrl_snapshotDate: {
                postUrl: url.postUrl,
                snapshotDate: today.toDate(),
              },
            },
            create: {
              campaignId: url.campaignId,
              submissionId: url.submissionId,
              postUrl: url.postUrl,
              platform,
              userId: url.submission.userId,
              postDate: postDate.toDate(),
              snapshotDate: today.toDate(),
              daysSincePost,
              capturedAt: new Date(),
              views: metrics.views,
              likes: metrics.likes,
              comments: metrics.comments,
              shares: metrics.shares,
              saved: metrics.saved,
              reach: metrics.reach,
              engagementRate: metrics.engagementRate,
              rawMetrics: result.insight,
            },
            update: {
              daysSincePost,
              capturedAt: new Date(),
              views: metrics.views,
              likes: metrics.likes,
              comments: metrics.comments,
              shares: metrics.shares,
              saved: metrics.saved,
              reach: metrics.reach,
              engagementRate: metrics.engagementRate,
              rawMetrics: result.insight,
            },
          });

          stats.captured++;
        } catch (error: any) {
          console.error(`   ❌ Upsert failed for ${url.postUrl}: ${error.message}`);
          stats.failed++;
        }
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('📊 DAILY SNAPSHOT SUMMARY');
    console.log('='.repeat(80));
    console.log(`   Processed: ${stats.processed}`);
    console.log(`   ✅ Captured: ${stats.captured}`);
    console.log(`   ⏭️  Skipped:  ${stats.skipped}`);
    console.log(`   ❌ Failed:   ${stats.failed}`);
    console.log('='.repeat(80) + '\n');

    return stats;
  } catch (error: any) {
    console.error('❌ Fatal error in daily post engagement collection:', error.message);
    throw error;
  }
}

/**
 * Capture a daily snapshot for a single posting URL.
 *
 * Used by the manual-trigger endpoint and by the test script. The
 * `snapshotDate` parameter lets callers simulate a specific calendar day
 * (start-of-day in Asia/Kuala_Lumpur); when omitted, "today" is used.
 *
 * The post must already exist in SubmissionPostingUrl with a postingDate.
 * Upserts on (postUrl, snapshotDate) so calling repeatedly with the same
 * snapshotDate simply refreshes the row.
 */
export async function captureDailyPostEngagementForUrl(
  postUrl: string,
  snapshotDate?: Date,
): Promise<{
  postUrl: string;
  snapshotDate: Date;
  daysSincePost: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saved: number;
  reach: number;
  engagementRate: number;
}> {
  const postingUrl = await prisma.submissionPostingUrl.findFirst({
    where: { postUrl },
    include: { submission: { select: { id: true, userId: true } } },
  });

  if (!postingUrl) {
    throw new Error(`Posting URL not found in SubmissionPostingUrl: ${postUrl}`);
  }
  if (!postingUrl.postingDate) {
    throw new Error(`Posting URL has no postingDate: ${postUrl}`);
  }

  const platform = postingUrl.platform as 'Instagram' | 'TikTok';
  if (platform !== 'Instagram' && platform !== 'TikTok') {
    throw new Error(`Unsupported platform "${postingUrl.platform}" for ${postUrl}`);
  }

  const snapshotStart = dayjs(snapshotDate ?? new Date())
    .tz('Asia/Kuala_Lumpur')
    .startOf('day');
  const postDate = dayjs(postingUrl.postingDate).tz('Asia/Kuala_Lumpur').startOf('day');
  const daysSincePost = snapshotStart.diff(postDate, 'day');

  const results = await batchFetchInsights({
    platform,
    requests: [
      {
        mediaId: postingUrl.mediaId || undefined,
        shortCode: postingUrl.shortCode || undefined,
        userId: postingUrl.submission.userId,
        campaignId: postingUrl.campaignId,
      },
    ],
    batchSize: 1,
    delayMs: 0,
  });

  if (results.length === 0 || results[0].error || !results[0].insight) {
    throw new Error(`Failed to fetch insights for ${postUrl}: ${results[0]?.error ?? 'no result'}`);
  }

  const metrics = extractMetrics(results[0].insight, platform);

  await prisma.dailyPostEngagementSnapshot.upsert({
    where: {
      postUrl_snapshotDate: {
        postUrl,
        snapshotDate: snapshotStart.toDate(),
      },
    },
    create: {
      campaignId: postingUrl.campaignId,
      submissionId: postingUrl.submissionId,
      postUrl,
      platform,
      userId: postingUrl.submission.userId,
      postDate: postDate.toDate(),
      snapshotDate: snapshotStart.toDate(),
      daysSincePost,
      capturedAt: new Date(),
      views: metrics.views,
      likes: metrics.likes,
      comments: metrics.comments,
      shares: metrics.shares,
      saved: metrics.saved,
      reach: metrics.reach,
      engagementRate: metrics.engagementRate,
      rawMetrics: results[0].insight,
    },
    update: {
      daysSincePost,
      capturedAt: new Date(),
      views: metrics.views,
      likes: metrics.likes,
      comments: metrics.comments,
      shares: metrics.shares,
      saved: metrics.saved,
      reach: metrics.reach,
      engagementRate: metrics.engagementRate,
      rawMetrics: results[0].insight,
    },
  });

  return {
    postUrl,
    snapshotDate: snapshotStart.toDate(),
    daysSincePost,
    ...metrics,
  };
}

/**
 * Read API: return the daily engagement time series for a single submission
 * (one post). Sorted ascending by snapshotDate. Optionally bounded to the
 * last N days. Powers the per-post engagement-rate / views chart.
 */
export async function getPostEngagementTrend(
  submissionId: string,
  options: { days?: number } = {},
): Promise<
  {
    snapshotDate: Date;
    daysSincePost: number;
    views: number;
    likes: number;
    comments: number;
    shares: number;
    saved: number;
    reach: number;
    engagementRate: number;
  }[]
> {
  const { days } = options;
  const where: any = { submissionId };
  if (days && days > 0) {
    where.snapshotDate = {
      gte: dayjs().tz('Asia/Kuala_Lumpur').subtract(days, 'day').startOf('day').toDate(),
    };
  }

  const rows = await prisma.dailyPostEngagementSnapshot.findMany({
    where,
    orderBy: { snapshotDate: 'asc' },
    select: {
      snapshotDate: true,
      daysSincePost: true,
      views: true,
      likes: true,
      comments: true,
      shares: true,
      saved: true,
      reach: true,
      engagementRate: true,
    },
  });

  return rows;
}

/**
 * Read API: same as getPostEngagementTrend but keyed on a single posting URL
 * instead of a submissionId. Used by the content performance report, which
 * already has the post URL in hand and does not have the submission ID.
 */
export async function getPostEngagementTrendByUrl(
  postUrl: string,
  options: { days?: number } = {},
): Promise<
  {
    snapshotDate: Date;
    daysSincePost: number;
    views: number;
    likes: number;
    comments: number;
    shares: number;
    saved: number;
    reach: number;
    engagementRate: number;
  }[]
> {
  const { days } = options;
  const where: any = { postUrl };
  if (days && days > 0) {
    where.snapshotDate = {
      gte: dayjs().tz('Asia/Kuala_Lumpur').subtract(days, 'day').startOf('day').toDate(),
    };
  }

  const rows = await prisma.dailyPostEngagementSnapshot.findMany({
    where,
    orderBy: { snapshotDate: 'asc' },
    select: {
      snapshotDate: true,
      daysSincePost: true,
      views: true,
      likes: true,
      comments: true,
      shares: true,
      saved: true,
      reach: true,
      engagementRate: true,
    },
  });

  return rows;
}

/**
 * Read API: return all per-post daily series for a campaign, grouped by post.
 * Powers a multi-line chart where each line is a single creator's post.
 * Optionally filtered by platform and bounded to the last N days.
 */
export async function getCampaignPostTrends(
  campaignId: string,
  options: { days?: number; platform?: string } = {},
): Promise<
  {
    submissionId: string;
    userId: string;
    postUrl: string;
    platform: string;
    postDate: Date;
    points: {
      snapshotDate: Date;
      daysSincePost: number;
      views: number;
      engagementRate: number;
    }[];
  }[]
> {
  const { days, platform } = options;
  const where: any = { campaignId };
  if (days && days > 0) {
    where.snapshotDate = {
      gte: dayjs().tz('Asia/Kuala_Lumpur').subtract(days, 'day').startOf('day').toDate(),
    };
  }
  if (platform && platform !== 'All') {
    where.platform = platform;
  }

  const rows = await prisma.dailyPostEngagementSnapshot.findMany({
    where,
    orderBy: [{ submissionId: 'asc' }, { snapshotDate: 'asc' }],
  });

  const grouped = new Map<
    string,
    {
      submissionId: string;
      userId: string;
      postUrl: string;
      platform: string;
      postDate: Date;
      points: any[];
    }
  >();

  for (const row of rows) {
    const key = row.submissionId;
    if (!grouped.has(key)) {
      grouped.set(key, {
        submissionId: row.submissionId,
        userId: row.userId,
        postUrl: row.postUrl,
        platform: row.platform,
        postDate: row.postDate,
        points: [],
      });
    }
    grouped.get(key)!.points.push({
      snapshotDate: row.snapshotDate,
      daysSincePost: row.daysSincePost,
      views: row.views,
      engagementRate: row.engagementRate,
    });
  }

  return Array.from(grouped.values());
}

/**
 * Manually trigger snapshot capture for a specific post
 * Useful for testing or manual backfills
 */
export async function captureManualSnapshot(
  campaignId: string,
  postUrl: string,
  snapshotDay: 7 | 15 | 30,
): Promise<void> {
  console.log(`\n📸 Manual snapshot capture for post: ${postUrl} (Day ${snapshotDay})`);

  const postingUrl = await prisma.submissionPostingUrl.findFirst({
    where: {
      campaignId,
      postUrl,
    },
    include: {
      submission: {
        select: {
          userId: true,
          id: true,
        },
      },
    },
  });

  if (!postingUrl) {
    throw new Error(`Post URL not found: ${postUrl}`);
  }

  const snapshot = await capturePostSnapshot(campaignId, postingUrl, snapshotDay);

  if (!snapshot) {
    throw new Error('Failed to capture snapshot');
  }

  await storePostSnapshot(snapshot);
  console.log(`✅ Manual snapshot captured: ER ${snapshot.metrics.engagementRate.toFixed(2)}%`);
}

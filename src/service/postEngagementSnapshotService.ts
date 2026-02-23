import { PrismaClient } from '@prisma/client';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { batchFetchInsights } from './socialMediaBatchService';

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
          const snapshot = await capturePostSnapshot(
            campaign.id,
            postingUrl,
            snapshotDayToCapture
          );

          if (snapshot) {
            await storePostSnapshot(snapshot);
            console.log(
              `         ✅ Captured Day ${snapshotDayToCapture} snapshot: ER ${snapshot.metrics.engagementRate.toFixed(2)}%`
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
  snapshotDay: number
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
 * Extract and calculate metrics from raw insight data
 */
function extractMetrics(
  insight: any,
  platform: 'Instagram' | 'TikTok'
): {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saved: number;
  reach: number;
  engagementRate: number;
} {
  let views = 0;
  let likes = 0;
  let comments = 0;
  let shares = 0;
  let saved = 0;
  let reach = 0;

  if (platform === 'Instagram') {
    // Extract from Instagram insight structure
    views = insight.video?.plays || insight.video?.views || 0;
    likes = insight.video?.like_count || 0;
    comments = insight.video?.comments_count || 0;
    shares = 0; // Instagram doesn't provide shares in basic insights
    saved = 0;
    reach = insight.video?.reach || 0;

    // Try to get shares and saved from insights array
    if (Array.isArray(insight)) {
      insight.forEach((item: any) => {
        if (item.name === 'shares') shares = item.values?.[0]?.value || 0;
        if (item.name === 'saved') saved = item.values?.[0]?.value || 0;
      });
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

  // Calculate engagement rate
  const totalEngagements = likes + comments + shares + saved;
  const engagementRate = views > 0 ? (totalEngagements / views) * 100 : 0;

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
export async function getPostEngagementSnapshots(
  campaignId: string
): Promise<
  Array<{
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
  }>
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

/**
 * Manually trigger snapshot capture for a specific post
 * Useful for testing or manual backfills
 */
export async function captureManualSnapshot(
  campaignId: string,
  postUrl: string,
  snapshotDay: 7 | 15 | 30
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

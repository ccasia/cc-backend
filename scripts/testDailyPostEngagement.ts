// @ts-nocheck
import { PrismaClient } from '@prisma/client';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { getPostEngagementTrend } from '../src/service/postEngagementSnapshotService';

dayjs.extend(utc);
dayjs.extend(timezone);

const prisma = new PrismaClient();

/**
 * TEST SCRIPT: Daily Post Engagement — Synthetic 6-Week Trend
 *
 * Seeds 42 days (6 weeks) of synthetic, *varied* daily snapshots for ONE
 * posting URL that already exists in SubmissionPostingUrl. This is a UI
 * fixture generator — it lets the per-post heatmap and line chart render
 * with realistic-looking trend data while we build them.
 *
 * Run:
 *   ts-node scripts/testDailyPostEngagement.ts <postUrl>
 *
 * Examples:
 *   ts-node scripts/testDailyPostEngagement.ts https://www.instagram.com/p/DW6COcsyUpv/
 *   ts-node scripts/testDailyPostEngagement.ts https://www.tiktok.com/@cultcreativeasia/video/7517549194530344200
 *
 * IMPORTANT — this script does NOT call the Instagram/TikTok APIs. It writes
 * synthetic metrics directly to DailyPostEngagementSnapshot using the same
 * upsert key (postUrl, snapshotDate) the production capture function uses.
 * That means it still validates: the table schema, the unique constraint,
 * the read API (getPostEngagementTrend), and that idempotent re-runs work.
 * It does *not* validate the live API fetch path — the production cron is
 * the only thing that exercises that.
 *
 * Growth model: views/likes follow logarithmic accumulation (most engagement
 * in the first few days, tapering off), with ±15% daily jitter so the heatmap
 * has visible variance and the line chart isn't flat.
 *
 * Date range: snapshots are written for the last SIM_DAYS calendar days
 * ENDING TODAY (i.e. today, today-1, …, today-41). This means the per-post
 * heatmap's latest column always lines up with the current week, and the
 * line chart's current-week view will populate Mon → today.
 *
 * To make the growth curve aligned with that range, the script writes
 * each snapshot with a *synthetic* postDate equal to today - (SIM_DAYS - 1).
 * That keeps daysSincePost = 0 for the oldest snapshot and = 41 for today.
 * Note: this synthetic postDate is local to DailyPostEngagementSnapshot —
 * it does NOT modify SubmissionPostingUrl.postingDate.
 */

const SIM_DAYS = 42; // 6 weeks — matches the per-post heatmap's default window

interface SyntheticMetrics {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saved: number;
  reach: number;
  engagementRate: number;
}

/**
 * Generate one day's synthetic metrics. Logarithmic growth with ±15% jitter.
 * The post "ages" across SIM_DAYS, with daily numbers approaching plausible
 * platform-typical ceilings.
 */
function generateDayMetrics(dayN: number, platform: 'Instagram' | 'TikTok'): SyntheticMetrics {
  // 0 → ~1 across SIM_DAYS, with steepest growth in early days
  const ageGrowth = Math.log(dayN + 2) / Math.log(SIM_DAYS + 2);
  const jitter = 0.85 + Math.random() * 0.3; // 0.85 → 1.15

  // Plausible ceiling metrics for a mid-tier influencer post
  const targetViews = platform === 'TikTok' ? 50_000 : 12_000;
  const targetLikes = platform === 'TikTok' ? 3_500 : 800;

  const views = Math.max(50, Math.floor(targetViews * ageGrowth * jitter));
  const likes = Math.max(5, Math.floor(targetLikes * ageGrowth * jitter));
  const comments = Math.floor(likes * (0.04 + Math.random() * 0.04));
  const shares = Math.floor(likes * (0.02 + Math.random() * 0.03));
  const saved = platform === 'Instagram' ? Math.floor(likes * (0.06 + Math.random() * 0.08)) : 0;
  const reach = platform === 'Instagram' ? Math.floor(views * (1.1 + Math.random() * 0.2)) : views;

  // Mirror the engagement-rate formula in extractMetrics so synthetic ER
  // matches what the live capture would produce.
  let engagementRate = 0;
  if (platform === 'Instagram') {
    const denom = reach > 0 ? reach : views;
    if (denom > 0) {
      engagementRate = ((likes + comments + shares + saved) / denom) * 100;
    }
  } else if (views > 0) {
    engagementRate = ((likes + comments + shares) / views) * 100;
  }

  return {
    views,
    likes,
    comments,
    shares,
    saved,
    reach,
    engagementRate: Number(engagementRate.toFixed(2)),
  };
}

async function main() {
  const postUrl = process.argv[2];

  if (!postUrl) {
    console.error('❌ Missing postUrl argument.');
    console.error('Usage: ts-node scripts/testDailyPostEngagement.ts <postUrl>');
    process.exit(1);
  }

  console.log('\n' + '='.repeat(80));
  console.log(`🧪 DAILY POST ENGAGEMENT — ${SIM_DAYS}-DAY SYNTHETIC SEED`);
  console.log('='.repeat(80));
  console.log(`Target URL: ${postUrl}\n`);

  // STEP 1 — confirm the URL exists in SubmissionPostingUrl
  const postingUrl = await prisma.submissionPostingUrl.findFirst({
    where: { postUrl },
    include: {
      submission: { select: { id: true, userId: true } },
      campaign: { select: { id: true, name: true, status: true } },
    },
  });

  if (!postingUrl) {
    console.error(`❌ Posting URL not found in SubmissionPostingUrl: ${postUrl}`);
    process.exit(1);
  }
  if (!postingUrl.postingDate) {
    console.error(`❌ Posting URL has no postingDate: ${postUrl}`);
    process.exit(1);
  }

  const platform = postingUrl.platform as 'Instagram' | 'TikTok';
  if (platform !== 'Instagram' && platform !== 'TikTok') {
    console.error(`❌ Unsupported platform "${postingUrl.platform}"`);
    process.exit(1);
  }

  // Anchor synthetic data on today so the UI components show real-world dates.
  // Real postingDate is logged for context but is NOT used as the synthetic
  // postDate written into DailyPostEngagementSnapshot.
  const today = dayjs().tz('Asia/Kuala_Lumpur').startOf('day');
  const syntheticPostDate = today.subtract(SIM_DAYS - 1, 'day').startOf('day');

  console.log('📋 Posting record:');
  console.log(`   Campaign:        ${postingUrl.campaign.name} (${postingUrl.campaign.status})`);
  console.log(`   Submission:      ${postingUrl.submissionId}`);
  console.log(`   Platform:        ${platform}`);
  console.log(`   Real Post Date:  ${dayjs(postingUrl.postingDate).format('YYYY-MM-DD')}`);
  console.log(`   Synthetic span:  ${syntheticPostDate.format('YYYY-MM-DD')} → ${today.format('YYYY-MM-DD')} (today)`);
  console.log('');

  // STEP 2 — seed SIM_DAYS of synthetic varied snapshots ending today
  console.log(`🔁 Seeding ${SIM_DAYS} synthetic daily snapshots (Day 0 = ${syntheticPostDate.format('YYYY-MM-DD')} → Day ${SIM_DAYS - 1} = today)\n`);

  const captured: any[] = [];
  for (let i = 0; i < SIM_DAYS; i++) {
    const snapshotDate = syntheticPostDate.add(i, 'day').startOf('day');
    const metrics = generateDayMetrics(i, platform);

    try {
      await prisma.dailyPostEngagementSnapshot.upsert({
        where: {
          postUrl_snapshotDate: {
            postUrl,
            snapshotDate: snapshotDate.toDate(),
          },
        },
        create: {
          campaignId: postingUrl.campaignId,
          submissionId: postingUrl.submissionId,
          postUrl,
          platform,
          userId: postingUrl.submission.userId,
          postDate: syntheticPostDate.toDate(),
          snapshotDate: snapshotDate.toDate(),
          daysSincePost: i,
          capturedAt: new Date(),
          ...metrics,
          rawMetrics: { synthetic: true, dayN: i },
        },
        update: {
          postDate: syntheticPostDate.toDate(),
          daysSincePost: i,
          capturedAt: new Date(),
          ...metrics,
          rawMetrics: { synthetic: true, dayN: i },
        },
      });

      captured.push({ dayN: i, snapshotDate: snapshotDate.toDate(), ...metrics });

      console.log(
        `   Day ${String(i).padStart(2)} (${snapshotDate.format('YYYY-MM-DD')})  ` +
          `views=${metrics.views.toString().padStart(6)}  ` +
          `likes=${metrics.likes.toString().padStart(5)}  ` +
          `comments=${metrics.comments.toString().padStart(4)}  ` +
          `shares=${metrics.shares.toString().padStart(4)}  ` +
          (platform === 'Instagram' ? `saved=${metrics.saved.toString().padStart(4)}  ` : '') +
          `ER=${metrics.engagementRate.toFixed(2)}%`,
      );
    } catch (error: any) {
      console.error(`   Day ${i}: ❌ ${error.message}`);
    }
  }

  // STEP 3 — read back via the same API the frontend will use
  console.log('\n' + '-'.repeat(80));
  console.log('📈 Read-back via getPostEngagementTrend(submissionId):');
  console.log('-'.repeat(80));

  const trend = await getPostEngagementTrend(postingUrl.submissionId);

  console.log(`Rows returned: ${trend.length}\n`);
  console.table(
    trend.map((row) => ({
      snapshotDate: dayjs(row.snapshotDate).format('YYYY-MM-DD'),
      daysSincePost: row.daysSincePost,
      views: row.views,
      likes: row.likes,
      comments: row.comments,
      shares: row.shares,
      saved: row.saved,
      reach: row.reach,
      engagementRate: Number(row.engagementRate.toFixed(2)),
    })),
  );

  // STEP 4 — sanity assertions
  console.log('\n' + '-'.repeat(80));
  console.log('✅ Sanity checks:');
  console.log('-'.repeat(80));

  const expectedDays = Array.from({ length: SIM_DAYS }, (_, i) => i);
  const actualDays = trend.map((r) => r.daysSincePost).sort((a, b) => a - b);
  const missingDays = expectedDays.filter((d) => !actualDays.includes(d));
  const uniqueSnapshotDates = new Set(trend.map((r) => dayjs(r.snapshotDate).format('YYYY-MM-DD')));

  const erValues = trend.map((r) => r.engagementRate).filter((v) => v > 0);
  const minEr = erValues.length ? Math.min(...erValues) : 0;
  const maxEr = erValues.length ? Math.max(...erValues) : 0;

  console.log(`   Captured rows:           ${captured.length} / ${SIM_DAYS}`);
  console.log(`   Trend rows returned:     ${trend.length}`);
  console.log(`   Unique snapshotDates:    ${uniqueSnapshotDates.size}  (should equal trend rows)`);
  console.log(`   Missing daysSincePost:   ${missingDays.length === 0 ? 'none ✅' : missingDays.join(', ')}`);
  console.log(`   daysSincePost range:     ${actualDays[0]} → ${actualDays[actualDays.length - 1]}`);
  console.log(`   ER range:                ${minEr.toFixed(2)}% → ${maxEr.toFixed(2)}% (should vary)`);

  console.log('\n' + '='.repeat(80) + '\n');
}

main()
  .catch((error) => {
    console.error('❌ Test script failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

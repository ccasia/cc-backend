// src/services/dataCollector.ts
// ─────────────────────────────────────────────────────────────────────────────
// Each collect function merges two data sources:
//   1. DB data    — fetched via Prisma (always present)
//   2. External   — passed in from TikTok/Instagram API calls made by your
//                   existing backend before hitting this report endpoint
//
// Strategy: external metrics OVERRIDE DB metrics when provided.
// DB data is always the fallback so reports never fail on missing API data.
// ─────────────────────────────────────────────────────────────────────────────

// import { prisma } from 'src/prisma/prisma';
import { ReportSection, ExternalMetrics } from '../types/index';
import { prisma } from '@/src/prisma/prisma';

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (d: Date | null | undefined) =>
  d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'N/A';

const daysBetween = (a: Date, b: Date) => Math.ceil((b.getTime() - a.getTime()) / 86_400_000);

// ── Section 1: Campaign Summary ───────────────────────────────────────────────

async function collectCampaignSummary(campaignId: string, ext?: ExternalMetrics['summary']) {
  const campaign = await prisma.campaign.findUniqueOrThrow({
    where: { id: campaignId },
    include: {
      campaignBrief: true,
      brand: { select: { name: true } },
      company: { select: { name: true } },
    },
  });

  if (!campaign.campaignBrief) {
    throw new Error(`Campaign "${campaign.name}" has no CampaignBrief.`);
  }

  const { startDate, endDate, postingStartDate, postingEndDate } = campaign.campaignBrief;
  const now = new Date();
  const daysElapsed = Math.max(0, daysBetween(startDate, now > endDate ? endDate : now));
  const daysRemaining = Math.max(0, daysBetween(now, endDate));

  const dailyPostSnapshots = await prisma.dailyPostEngagementSnapshot.findMany({
    where: { campaignId },
    orderBy: {
      snapshotDate: 'desc',
    },
    distinct: ['userId'],
  });

  const manualEntries = await prisma.manualCreatorEntry.findMany({
    where: {
      campaignId: campaignId,
    },
  });

  const consolidatedData = [...dailyPostSnapshots, ...manualEntries];

  const dbViews = consolidatedData.reduce((s, r) => s + r.views, 0);
  const dbLikes = consolidatedData.reduce((s, r) => s + r.likes, 0);
  const dbComments = consolidatedData.reduce((s, r) => s + r.comments, 0);
  const dbShares = consolidatedData.reduce((s, r) => s + r.shares, 0);
  const dbEngagements = dbLikes + dbComments + dbShares;
  const dbEngRate = consolidatedData.length
    ? +(consolidatedData.reduce((s, r) => s + r.engagementRate, 0) / consolidatedData.length).toFixed(2)
    : null;

  const postCount = await prisma.submissionPostingUrl.count({ where: { campaignId } });

  // Merge: external overrides DB when present
  const totalViews = dbViews;
  const totalEngagements = dbEngagements;
  const engagementRate = dbEngRate;
  const reach = null;
  const shares = dbShares;
  const likes = dbLikes;
  const comments = dbComments;

  return {
    // Meta
    campaignName: campaign.name,
    brandName: campaign.brand?.name ?? null,
    companyName: campaign.company?.name ?? null,
    status: campaign.status,
    period: `${fmt(startDate)} – ${fmt(endDate)}`,
    postingWindow: `${fmt(postingStartDate)} – ${fmt(postingEndDate)}`,
    daysTotal: daysBetween(startDate, endDate),
    daysElapsed,
    daysRemaining,
    // Metrics (merged)
    totalViews,
    totalEngagements,
    engagementRate,
    reach,
    // impressions,
    shares,
    likes,
    comments,
    // roas,
    totalPosts: postCount,
    // Credits (DB only)
    campaignCredits: campaign.campaignCredits ?? null,
    creditsUtilized: campaign.creditsUtilized ?? null,
    creditsPending: campaign.creditsPending ?? null,
    creditsRemaining:
      campaign.campaignCredits != null && campaign.creditsUtilized != null
        ? campaign.campaignCredits - campaign.creditsUtilized
        : null,
    utilizationRate:
      campaign.campaignCredits && campaign.creditsUtilized != null
        ? +((campaign.creditsUtilized / campaign.campaignCredits) * 100).toFixed(1)
        : null,
    // Source flags (lets frontend know which figures came from API)
    _sources: {
      views: ext?.totalViews != null ? 'external' : 'db',
      engagements: ext?.totalEngagements != null ? 'external' : 'db',
      engRate: ext?.engagementRate != null ? 'external' : 'db',
      roas: ext?.roas != null ? 'external' : 'none',
    },
  };
}

// ── Section 2: Engagement & Interactions ─────────────────────────────────────

async function collectEngagementData(campaignId: string, ext?: ExternalMetrics['engagement']) {
  const [brief, shortlisted, dailySnapshots, manualEntries] = await Promise.all([
    prisma.campaignBrief.findUnique({
      where: { campaignId },
      select: { postingStartDate: true, postingEndDate: true },
    }),
    prisma.shortListedCreator.findMany({
      where: { campaignId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            creator: {
              include: { tiktokUser: true, instagramUser: true },
            },
          },
        },
      },
    }),
    prisma.dailyPostEngagementSnapshot.findMany({
      where: { campaignId },
      select: {
        engagementRate: true,
        userId: true,
        snapshotDate: true,
        platform: true,
      },
      orderBy: {
        snapshotDate: 'desc',
      },
      distinct: ['userId'],
    }),
    prisma.manualCreatorEntry.findMany({
      where: {
        campaignId: campaignId,
      },
    }),
  ]);

  const consolidatedData = [...dailySnapshots, ...manualEntries];

  const dbEngRate = consolidatedData.length
    ? +(consolidatedData.reduce((s, r) => s + r.engagementRate, 0) / consolidatedData.length).toFixed(2)
    : null;

  const creatorEngagementLeaderboard = dailySnapshots
    .map((snapshot) => {
      const user = shortlisted.find((s) => s.userId === snapshot.userId);
      const platform = snapshot.platform;
      const userName =
        platform === 'tiktok'
          ? user?.user?.creator?.tiktokUser?.username
          : user?.user?.creator?.instagramUser?.username;

      return {
        userId: snapshot.userId,
        // name: shortlisted.find((s) => s.userId === snapshot.userId)?.user?.name ?? 'Unknown',
        engagementRate: +snapshot.engagementRate.toFixed(2),
        platform: shortlisted.find((s) => s.userId === snapshot.userId)?.selectedPlatform,
        userName: userName ?? 'Unknown',
        snapshotDate: fmt(snapshot.snapshotDate),
      };
    })
    .sort((a, b) => b.engagementRate - a.engagementRate)
    .map((entry, index) => ({ rank: index + 1, ...entry }));

  return {
    postingStartDate: fmt(brief?.postingStartDate),
    postingEndDate: fmt(brief?.postingEndDate),
    creatorEngagementLeaderboard,
    engagementRate: dbEngRate,
  };
}

// ── Section 3: Views Analysis ─────────────────────────────────────────────────

// How many creators to list in each Views Analysis leaderboard.
const TOP_VIEWS_COUNT = 5;

async function collectViewsData(campaignId: string, ext?: ExternalMetrics['views']) {
  const [brief, shortlisted, dailySnapshots, manualEntries, day2Snapshots] = await Promise.all([
    prisma.campaignBrief.findUnique({
      where: { campaignId },
      select: { postingStartDate: true, postingEndDate: true },
    }),
    prisma.shortListedCreator.findMany({
      where: { campaignId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            creator: {
              include: { tiktokUser: true, instagramUser: true },
            },
          },
        },
      },
    }),
    prisma.dailyPostEngagementSnapshot.findMany({
      where: { campaignId },
      select: {
        engagementRate: true,
        userId: true,
        snapshotDate: true,
        platform: true,
        likes: true,
        comments: true,
        saved: true,
        shares: true,
        views: true,
      },
      orderBy: {
        snapshotDate: 'desc',
      },
      distinct: ['userId'],
    }),
    prisma.manualCreatorEntry.findMany({
      where: {
        campaignId: campaignId,
      },
    }),
    // The 48h-after-posting reading: daysSincePost is whole days since that post's own postDate,
    // so daysSincePost: 2 is each post's day-2 snapshot regardless of when it was actually posted.
    // Manual entries have no such series (one static number, not a dated snapshot) so they're
    // excluded from this ranking — only the "current views" one below includes them.
    prisma.dailyPostEngagementSnapshot.findMany({
      where: { campaignId, daysSincePost: 2 },
      select: { userId: true, views: true, platform: true },
      orderBy: { views: 'desc' },
      distinct: ['userId'],
    }),
  ]);

  const shortlistedByUserId = new Map(shortlisted.map((s) => [s.userId, s]));

  // Single source of truth for creator name/username so the day-2 ranking below can't drift
  // from structedJoinedData's platform-casing handling ('TikTok'/'Instagram', not lowercase).
  const resolveCreatorDisplay = (userId: string, platform: string) => {
    const creator = shortlistedByUserId.get(userId);
    return {
      name: creator?.user?.name ?? 'Unknown',
      username:
        (platform === 'TikTok'
          ? creator?.user?.creator?.tiktokUser?.username
          : creator?.user?.creator?.instagramUser?.username) ?? null,
    };
  };

  const structedJoinedData = [
    ...dailySnapshots.map((item) => ({
      userId: item.userId as string | undefined,
      likes: item.likes,
      comments: item.comments,
      shares: item.shares,
      saved: item.saved,
      views: item.views,
      platform: item.platform,
      snapshotDate: item.snapshotDate,
      ...resolveCreatorDisplay(item.userId, item.platform),
    })),
    // Manual entries have no userId (there's no real creator account behind them), so they never
    // match a day-2 row below — matches how they're already excluded from topViews48hCreators.
    ...manualEntries.map((item) => ({
      userId: undefined as string | undefined,
      likes: item.likes,
      comments: item.comments,
      shares: item.shares,
      saved: item.saved,
      views: item.views,
      platform: item.platform,
      name: item.creatorName,
      snapshotDate: item.createdAt,
      username: item.creatorUsername,
    })),
  ];

  // Top creators by current (most recently captured) views.
  const topViewsCreators = [...structedJoinedData].sort((a, b) => b.views - a.views).slice(0, TOP_VIEWS_COUNT);

  // Top creators by views specifically at the 48h mark, not their latest/current views.
  const topViews48hCreators = day2Snapshots
    .sort((a, b) => b.views - a.views)
    .slice(0, TOP_VIEWS_COUNT)
    .map(({ userId, views, platform }) => ({
      views,
      platform,
      ...resolveCreatorDisplay(userId, platform),
    }));

  // What share of the top creators' own views had already landed within 48h of posting — each
  // top creator's day-2 reading matched to THEM by userId, not the (possibly different) set of
  // creators in topViews48hCreators above, which is its own independent ranking.
  const day2ViewsByUserId = new Map(day2Snapshots.map((s) => [s.userId, s.views]));
  const topViewsTotal = topViewsCreators.reduce((sum, c) => sum + c.views, 0);
  const topViewsEarly48hTotal = topViewsCreators.reduce(
    (sum, c) => sum + (c.userId ? (day2ViewsByUserId.get(c.userId) ?? 0) : 0),
    0,
  );
  const earlyViewsPercent = topViewsTotal ? +((topViewsEarly48hTotal / topViewsTotal) * 100).toFixed(1) : null;

  // Campaign-wide view totals per platform (not just the top creators), to say which platform
  // is actually carrying the campaign's reach.
  const viewsByPlatform = Object.entries(
    structedJoinedData.reduce<Record<string, number>>((acc, item) => {
      acc[item.platform] = (acc[item.platform] ?? 0) + item.views;
      return acc;
    }, {}),
  ).map(([platform, views]) => ({ platform, views }));
  const totalViewsAllPlatforms = viewsByPlatform.reduce((sum, p) => sum + p.views, 0);
  const viewsByPlatformRanked = viewsByPlatform
    .map((p) => ({
      ...p,
      viewShare: totalViewsAllPlatforms ? +((p.views / totalViewsAllPlatforms) * 100).toFixed(1) : 0,
    }))
    .sort((a, b) => b.views - a.views);

  return {
    postingStartDate: fmt(brief?.postingStartDate),
    postingEndDate: fmt(brief?.postingEndDate),
    topViewsCreators,
    topViews48hCreators,
    earlyViewsPercent,
    viewsByPlatform: viewsByPlatformRanked,
  };
}

// ── Section 4: Platform Breakdown ────────────────────────────────────────────

async function collectPlatformBreakdownData(campaignId: string, ext?: ExternalMetrics['engagement']) {
  const [brief, shortlisted, dailySnapshots, manualEntries] = await Promise.all([
    prisma.campaignBrief.findUnique({
      where: { campaignId },
      select: { postingStartDate: true, postingEndDate: true },
    }),
    prisma.shortListedCreator.findMany({
      where: { campaignId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            creator: {
              include: { tiktokUser: true, instagramUser: true },
            },
          },
        },
      },
    }),
    prisma.dailyPostEngagementSnapshot.findMany({
      where: { campaignId },
      select: {
        engagementRate: true,
        userId: true,
        snapshotDate: true,
        platform: true,
        likes: true,
        comments: true,
        saved: true,
        shares: true,
        views: true,
      },
      orderBy: {
        snapshotDate: 'desc',
      },
      distinct: ['userId'],
    }),
    prisma.manualCreatorEntry.findMany({
      where: {
        campaignId: campaignId,
      },
    }),
  ]);

  const shortlistedByUserId = new Map(shortlisted.map((s) => [s.userId, s]));

  const structedJoinedData = [
    ...dailySnapshots.map((item) => {
      const creator = shortlistedByUserId.get(item.userId);
      const username =
        item.platform === 'TikTok'
          ? creator?.user?.creator?.tiktokUser?.username
          : creator?.user?.creator?.instagramUser?.username;

      return {
        likes: item.likes,
        comments: item.comments,
        shares: item.shares,
        saved: item.saved,
        views: item.views,
        platform: item.platform,
        name: creator?.user?.name,
        username,
      };
    }),
    ...manualEntries.map((item) => ({
      likes: item.likes,
      comments: item.comments,
      shares: item.shares,
      saved: item.saved,
      views: item.views,
      platform: item.platform,
      name: item.creatorName,
      username: item.creatorUsername,
    })),
  ];

  const totalInteractions = structedJoinedData.reduce(
    (a, s) => a + s.comments + s.likes + (s.saved ?? 0) + s.shares,
    0,
  );

  const platformsInteraction = structedJoinedData.reduce<Record<string, number>>((a, s) => {
    const platform = s.platform;

    a[platform] = (a[platform] ?? 0) + s.likes + s.comments + (s.saved ?? 0) + s.shares;

    return a;
  }, {});

  const getTopUser = (type: 'likes' | 'shares') =>
    structedJoinedData.length
      ? structedJoinedData.reduce((best, entry) => (entry[type] > best[type] ? entry : best))
      : null;

  const topLikes = getTopUser('likes');
  const topShares = getTopUser('shares');

  return {
    postingStartDate: fmt(brief?.postingStartDate),
    postingEndDate: fmt(brief?.postingEndDate),
    totalInteractions,
    platformsInteraction,
    topLikes,
    topShares,
  };
}

// ── Section 5: Audience Sentiment ────────────────────────────────────────────

async function collectSentimentData(campaignId: string, ext?: ExternalMetrics['sentiment']) {
  const submissions = await prisma.submission.findMany({
    where: { campaignId },
    include: { feedback: true, publicFeedback: true },
  });

  const allFeedback = submissions
    .flatMap((s) => [
      ...s.feedback.map((f) => ({ content: f.content ?? '', type: String(f.type ?? 'COMMENT'), reasons: f.reasons })),
      ...s.publicFeedback.map((f) => ({
        content: f.content ?? '',
        type: String(f.type ?? 'COMMENT'),
        reasons: [] as string[],
      })),
    ])
    .filter((f) => f.content.trim().length > 0);

  // Keyword-based bucketing (DB feedback)
  const positiveKw = [
    'great',
    'good',
    'excellent',
    'approved',
    'perfect',
    'love',
    'amazing',
    'nice',
    'clear',
    'well done',
  ];
  const negativeKw = ['change', 'revision', 'incorrect', 'wrong', 'fix', 'update', 'redo', 'not', 'missing', 'issue'];

  let dbPositive = 0,
    dbNegative = 0,
    dbNeutral = 0;
  for (const f of allFeedback) {
    const lower = f.content.toLowerCase();
    if (f.type === 'REQUEST' || negativeKw.some((k) => lower.includes(k))) dbNegative++;
    else if (positiveKw.some((k) => lower.includes(k))) dbPositive++;
    else dbNeutral++;
  }
  const dbTotal = allFeedback.length || 1;

  // Common reason tags from feedback
  const allReasons = submissions.flatMap((s) => s.feedback.flatMap((f) => f.reasons));
  const reasonCounts: Record<string, number> = {};
  for (const r of allReasons) reasonCounts[r] = (reasonCounts[r] ?? 0) + 1;
  const topNegativeThemes = Object.entries(reasonCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([r]) => r);

  const sampleFeedback = allFeedback.slice(0, 6).map((f) => ({
    content: f.content.slice(0, 120),
    type: f.type,
  }));

  // Merge: external rates override DB-derived rates if provided
  const positiveRate = ext?.positiveRate ?? +((dbPositive / dbTotal) * 100).toFixed(1);
  const neutralRate = ext?.neutralRate ?? +((dbNeutral / dbTotal) * 100).toFixed(1);
  const negativeRate = ext?.negativeRate ?? +((dbNegative / dbTotal) * 100).toFixed(1);

  return {
    totalFeedback: allFeedback.length,
    positiveCount: dbPositive,
    neutralCount: dbNeutral,
    negativeCount: dbNegative,
    positiveRate,
    neutralRate,
    negativeRate,
    commonNegativeThemes: topNegativeThemes,
    sampleFeedback: ext?.sampleComments ?? sampleFeedback,
    _source: ext?.positiveRate != null ? 'external' : 'db',
  };
}

// ── Section 6: Top Creator Personas ──────────────────────────────────────────

async function collectTopCreatorPersonas(campaignId: string, ext?: ExternalMetrics['creators']) {
  const shortlisted = await prisma.shortListedCreator.findMany({
    where: { campaignId },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          creator: {
            include: { tiktokUser: true, instagramUser: true, interests: true },
          },
        },
      },
    },
  });

  const [submissionCounts, approvedCounts] = await Promise.all([
    prisma.submission.groupBy({
      by: ['userId'],
      where: { campaignId },
      _count: { id: true },
    }),
    prisma.submission.groupBy({
      by: ['userId'],
      where: { campaignId, status: 'APPROVED' },
      _count: { id: true },
    }),
  ]);

  const subMap = Object.fromEntries(submissionCounts.map((s) => [s.userId, s._count.id]));
  const approvedMap = Object.fromEntries(approvedCounts.map((s) => [s.userId, s._count.id]));
  const extMap = new Map((ext ?? []).map((c) => [c.userId, c]));

  const [dailyPostSnapshots, manualEntries] = await Promise.all([
    prisma.dailyPostEngagementSnapshot.findMany({
      where: { campaignId },

      orderBy: {
        snapshotDate: 'desc',
      },
      distinct: ['userId'],
    }),
    prisma.manualCreatorEntry.findMany({
      where: {
        campaignId: campaignId,
      },
    }),
  ]);

  const userIds = dailyPostSnapshots.map((item) => item.userId);

  const users = await prisma.user.findMany({
    where: {
      id: {
        in: userIds,
      },
    },
    select: {
      id: true,
      name: true,
    },
  });

  const newData = dailyPostSnapshots.map((item) => {
    const name = users.find((a) => a.id === item.userId);

    return {
      ...item,
      name,
    };
  });

  const consolidatedData = [...newData, ...manualEntries];

  const creators = shortlisted
    .map((s) => {
      const userId = s.user?.id ?? '';
      const extData = extMap.get(userId);
      const tiktok = s.user?.creator?.tiktokUser;
      const instagram = s.user?.creator?.instagramUser;
      const platform = tiktok ? 'TikTok' : instagram ? 'Instagram' : 'Unknown';
      const interests = s.user?.creator?.interests?.map((i) => i.name).filter(Boolean) ?? [];

      return {
        name: s.user?.name ?? 'Unknown',
        platform,
        followers: extData?.followers ?? tiktok?.follower_count ?? instagram?.followers_count ?? null,
        engagementRate: extData?.engagementRate ?? tiktok?.engagement_rate ?? instagram?.engagement_rate ?? null,
        totalViews: extData?.totalViews ?? 0,
        totalLikes: extData?.totalLikes ?? tiktok?.totalLikes ?? instagram?.totalLikes ?? 0,
        totalComments: extData?.totalComments ?? tiktok?.totalComments ?? instagram?.totalComments ?? 0,
        ugcVideos: s.ugcVideos ?? null,
        amount: s.amount ?? null,
        totalSubmissions: subMap[userId] ?? 0,
        approvedContent: approvedMap[userId] ?? 0,
        contentStyle: interests.slice(0, 3).join(', ') || null,
        _source: extData ? 'external' : 'db',
      };
    })
    .sort((a, b) => (b.engagementRate ?? 0) - (a.engagementRate ?? 0));

  return { consolidatedData };
}

// ── Section 7: Recommendations ────────────────────────────────────────────────
// No additional collection — receives all other sections as context

async function collectRecommendationsContext(allSectionData: Record<string, unknown>) {
  return { allSectionData };
}

// ── Master dispatcher ─────────────────────────────────────────────────────────

export async function collectSectionData(
  section: ReportSection,
  campaignId: string,
  ext?: ExternalMetrics,
  allData?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  // logger.debug(`Collecting: ${section}`);

  switch (section) {
    case 'campaign_summary':
      return collectCampaignSummary(campaignId, ext?.summary);
    case 'engagement_interactions':
      return collectEngagementData(campaignId, ext?.engagement);
    case 'views_analysis':
      return collectViewsData(campaignId, ext?.views);
    case 'platform_breakdown':
      return collectPlatformBreakdownData(campaignId, ext?.engagement);
    case 'audience_sentiment':
      return collectSentimentData(campaignId, ext?.sentiment);
    case 'top_creator_personas':
      return collectTopCreatorPersonas(campaignId, ext?.creators);
    case 'campaign_recommendations':
      return collectRecommendationsContext(allData ?? {});
    default:
      throw new Error(`Unknown section: ${section}`);
  }
}

async function main() {
  const res = await collectViewsData('cmjcdy6k203tnp301pqw0rqq2');

  // console.log(res);
}

// main().then(() => console.log('DONE ✨'));

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

import { prisma } from 'src/prisma/prisma';
import { ReportSection, ExternalMetrics } from '../types/index';

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

  // DB fallback: aggregate InsightSnapshots
  const snapshots = await prisma.insightSnapshot.findMany({
    where: { campaignId, snapshotType: 'weekly' },
  });

  const dbViews = snapshots.reduce((s, r) => s + r.totalViews, 0);
  const dbLikes = snapshots.reduce((s, r) => s + r.totalLikes, 0);
  const dbComments = snapshots.reduce((s, r) => s + r.totalComments, 0);
  const dbShares = snapshots.reduce((s, r) => s + r.totalShares, 0);
  const dbEngagements = dbLikes + dbComments + dbShares;
  const dbEngRate = snapshots.length
    ? +(snapshots.reduce((s, r) => s + r.averageEngagementRate, 0) / snapshots.length).toFixed(2)
    : null;

  const postCount = await prisma.submissionPostingUrl.count({ where: { campaignId } });

  // Merge: external overrides DB when present
  const totalViews = ext?.totalViews ?? dbViews;
  const totalEngagements = ext?.totalEngagements ?? dbEngagements;
  const engagementRate = ext?.engagementRate ?? dbEngRate;
  const reach = ext?.reach ?? null;
  const impressions = ext?.impressions ?? null;
  const roas = ext?.roas ?? null;

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
    impressions,
    roas,
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
  const [snapshots, brief, shortlisted, postUrls] = await Promise.all([
    prisma.insightSnapshot.findMany({
      where: { campaignId, snapshotType: 'weekly' },
      orderBy: { snapshotDate: 'asc' },
    }),
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
    prisma.submissionPostingUrl.findMany({
      where: { campaignId },
      select: { platform: true },
    }),
  ]);

  // Build weekly engagement — prefer external weekly data if provided
  const dbWeekly = snapshots.map((s, i) => ({
    week: `Week ${i + 1}`,
    date: fmt(s.snapshotDate),
    views: s.totalViews,
    likes: s.totalLikes,
    comments: s.totalComments,
    shares: s.totalShares,
    engagement: s.totalLikes + s.totalComments + s.totalShares,
    engRate: +s.averageEngagementRate.toFixed(2),
  }));

  // Normalise both sources to a consistent shape
  interface WeeklyEngagementEntry {
    week: string;
    date: string;
    views: number;
    likes: number;
    comments: number;
    shares: number;
    engagement: number;
    engRate: number;
  }

  const weeklyEngagement: WeeklyEngagementEntry[] = ext?.weeklyEngagement
    ? ext.weeklyEngagement.map((w) => ({
        week: w.week,
        date: w.week,
        views: w.views,
        likes: 0,
        comments: 0,
        shares: 0,
        engagement: w.engagement,
        engRate: 0,
      }))
    : dbWeekly;

  // Total engagement
  const dbTotal = dbWeekly.reduce((s, w) => s + w.engagement, 0);
  const totalEngagement = ext?.totalEngagement ?? dbTotal;

  // Peak period
  const peakEntry = dbWeekly.length
    ? dbWeekly.reduce((best, w) => (w.engagement > best.engagement ? w : best), dbWeekly[0])
    : null;
  const peakPeriod = ext?.peakWeek ?? peakEntry?.week ?? 'N/A';
  const peakEngagement = ext?.peakEngagement ?? peakEntry?.engagement ?? 0;

  // Platform breakdown — merge DB post counts with external engagement
  const dbPlatformMap: Record<string, number> = {};
  for (const p of postUrls) {
    dbPlatformMap[p.platform] = (dbPlatformMap[p.platform] ?? 0) + 1;
  }

  const platformBreakdown =
    ext?.platformBreakdown ??
    Object.entries(dbPlatformMap).map(([platform, posts]) => ({
      platform,
      posts,
      engagement: 0,
    }));

  // Top creators — merge DB social stats with external per-creator metrics
  const extCreatorMap = new Map((ext?.creatorMetrics ?? []).map((c) => [c.userId, c]));

  const topCreators = shortlisted
    .map((s) => {
      const userId = s.user?.id ?? '';
      const extData = extCreatorMap.get(userId);
      const tiktok = s.user?.creator?.tiktokUser;
      const instagram = s.user?.creator?.instagramUser;
      const platform = extData?.platform ?? (tiktok ? 'TikTok' : instagram ? 'Instagram' : 'Unknown');

      return {
        name: s.user?.name ?? 'Unknown',
        platform,
        engagementRate: extData?.engagementRate ?? tiktok?.engagement_rate ?? instagram?.engagement_rate ?? null,
        followers: extData?.followers ?? tiktok?.follower_count ?? instagram?.followers_count ?? null,
        views: extData?.views ?? 0,
        likes: extData?.likes ?? tiktok?.totalLikes ?? instagram?.totalLikes ?? 0,
        comments: extData?.comments ?? tiktok?.totalComments ?? instagram?.totalComments ?? 0,
        ugcVideos: s.ugcVideos ?? null,
        _source: extData ? 'external' : 'db',
      };
    })
    .sort((a, b) => (b.engagementRate ?? 0) - (a.engagementRate ?? 0))
    .slice(0, 5);

  return {
    totalEngagement,
    peakPeriod,
    peakEngagement,
    postingStartDate: fmt(brief?.postingStartDate),
    postingEndDate: fmt(brief?.postingEndDate),
    platformBreakdown,
    topCreators,
    weeklyEngagement,
  };
}

// ── Section 3: Views Analysis ─────────────────────────────────────────────────

async function collectViewsData(campaignId: string, ext?: ExternalMetrics['views']) {
  const snapshots = await prisma.insightSnapshot.findMany({
    where: { campaignId, snapshotType: 'weekly' },
    orderBy: { snapshotDate: 'asc' },
  });

  const dbWeekly = snapshots.map((s, i) => ({
    label: `Week ${i + 1}`,
    date: fmt(s.snapshotDate),
    views: s.totalViews,
  }));

  // Normalise both sources to { label, date, views } so the type is always consistent
  interface WeeklyViewEntry {
    label: string;
    date: string;
    views: number;
  }

  const weeklyViews: WeeklyViewEntry[] = ext?.weeklyViews
    ? ext.weeklyViews.map((w) => ({ label: w.week, date: w.week, views: w.views }))
    : dbWeekly;

  const allViews = weeklyViews.map((w) => w.views);
  const totalViews = ext?.totalViews ?? allViews.reduce((s, v) => s + v, 0);
  const peakViews = ext?.peakViews ?? Math.max(...(allViews.length ? allViews : [0]));
  const lowestViews = Math.min(...(allViews.length ? allViews : [0]));

  // Find peak week label
  const peakIdx = allViews.indexOf(peakViews);
  const peakWeek = ext?.peakWeek ?? (peakIdx >= 0 ? weeklyViews[peakIdx]?.label : 'N/A');

  // Growth trend
  let growthTrend = 'stable';
  if (weeklyViews.length >= 4) {
    const mid = Math.floor(weeklyViews.length / 2);
    const firstHalf = allViews.slice(0, mid).reduce((s, v) => s + v, 0) / mid;
    const secondHalf = allViews.slice(mid).reduce((s, v) => s + v, 0) / (weeklyViews.length - mid);
    const diff = ((secondHalf - firstHalf) / (firstHalf || 1)) * 100;

    if (peakIdx > 0 && peakIdx < weeklyViews.length - 1) growthTrend = 'peaked_mid_campaign';
    else if (diff > 10) growthTrend = 'increasing';
    else if (diff < -10) growthTrend = 'decreasing';
  }

  return {
    totalViews,
    peakWeek,
    peakViews,
    lowestViews,
    viewRange: `${(lowestViews / 1000).toFixed(0)}K – ${(peakViews / 1000).toFixed(0)}K`,
    growthTrend,
    weeklyViews,
    _source: ext?.totalViews != null ? 'external' : 'db',
  };
}

// ── Section 4: Audience Sentiment ────────────────────────────────────────────

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

// ── Section 5: Top Creator Personas ──────────────────────────────────────────

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

  return { creators };
}

// ── Section 6: Recommendations ────────────────────────────────────────────────
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

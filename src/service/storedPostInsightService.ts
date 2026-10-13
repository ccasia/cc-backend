import {
  getLatestCampaignPostEngagement,
  type LatestPostEngagementSnapshot,
} from '@services/postEngagementSnapshotService';
import { prisma } from '@/src/prisma/prisma';

type ReportPlatform = 'Instagram' | 'TikTok';

interface MetricData {
  name: string;
  value: number;
}

/** Public scrapes cannot see private Insights. `reach` is stored as a copy of views, so it is not real. */
const SCRAPE_UNAVAILABLE: Record<ReportPlatform, string[]> = {
  Instagram: ['saved', 'shares', 'reach'],
  TikTok: ['saved', 'reach'],
};

const toInsight = (snapshot: LatestPostEngagementSnapshot): MetricData[] => [
  { name: 'views', value: snapshot.views },
  { name: 'likes', value: snapshot.likes },
  { name: 'comments', value: snapshot.comments },
  { name: 'shares', value: snapshot.shares },
  { name: 'saved', value: snapshot.saved },
  { name: 'reach', value: snapshot.reach },
  {
    name: 'total_interactions',
    value: snapshot.likes + snapshot.comments + snapshot.shares + snapshot.saved,
  },
];

async function readCaption(postUrl: string, source?: string): Promise<string | null> {
  if (source !== 'brightdata') return null;
  const snapshot = await prisma.dailyPostEngagementSnapshot.findFirst({
    where: { postUrl, source: 'brightdata' },
    orderBy: { snapshotDate: 'desc' },
    select: { rawMetrics: true },
  });
  const item = (snapshot?.rawMetrics as { item?: Record<string, unknown> } | null)?.item;
  const caption = item?.description ?? item?.caption;
  return typeof caption === 'string' ? caption : null;
}

/**
 * The newest stored metrics for one campaign post, in the media-insight response shape.
 * Used when the creator has no valid token, so the live API cannot answer.
 * Null when no snapshot exists for the post.
 */
export async function getStoredPostInsight(platform: ReportPlatform, userId: string, url: string, campaignId: string) {
  const [postingUrls, snapshots] = await Promise.all([
    prisma.submissionPostingUrl.findMany({
      where: { campaignId, platform, submission: { userId } },
      select: { postUrl: true, shortCode: true, mediaId: true },
    }),
    getLatestCampaignPostEngagement(campaignId),
  ]);

  const posting = postingUrls.find((row) =>
    [row.postUrl, row.shortCode, row.mediaId].some((value) => !!value && url.includes(value)),
  );
  const platformSnapshots = snapshots.filter((snapshot) => snapshot.platform === platform);
  const snapshot = posting && platformSnapshots.find((item) => item.postUrl === posting.postUrl);
  if (!snapshot) return null;

  const insight = toInsight(snapshot);
  const metrics = Object.fromEntries(insight.map((metric) => [metric.name, metric.value]));
  const thumbnail = snapshot.thumbnailUrl ?? null;
  const caption = await readCaption(snapshot.postUrl, snapshot.source);

  return {
    insight,
    video: {
      timestamp: snapshot.postDate,
      caption,
      description: caption,
      thumbnail_url: thumbnail,
      media_url: thumbnail,
      cover_image_url: thumbnail,
      like_count: metrics.likes,
      comments_count: metrics.comments,
      comment_count: metrics.comments,
      view_count: metrics.views,
      share_count: metrics.shares,
    },
    postUrl: snapshot.postUrl,
    source: snapshot.source === 'brightdata' ? 'brightdata' : 'api',
    capturedAt: snapshot.capturedAt,
    unavailableMetrics: snapshot.source === 'brightdata' ? SCRAPE_UNAVAILABLE[platform] : [],
    campaignInsights: platformSnapshots.map(toInsight),
  };
}

/** Submissions with at least one stored metrics snapshot, from a scrape or the API. */
export async function findSubmissionsWithStoredMetrics(submissionIds: string[]): Promise<Set<string>> {
  if (submissionIds.length === 0) return new Set();
  const where = { submissionId: { in: submissionIds } };
  const [daily, milestone] = await Promise.all([
    prisma.dailyPostEngagementSnapshot.findMany({ where, distinct: ['submissionId'], select: { submissionId: true } }),
    prisma.postEngagementSnapshot.findMany({ where, distinct: ['submissionId'], select: { submissionId: true } }),
  ]);
  return new Set([...daily, ...milestone].map((row) => row.submissionId));
}

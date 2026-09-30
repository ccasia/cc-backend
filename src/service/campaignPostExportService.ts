import dayjs from 'dayjs';
import { prisma } from '@/src/prisma/prisma';
import { getLatestCampaignPostEngagement } from '@services/postEngagementSnapshotService';
import { createSpreadSheetWithData, upsertSheetAndWriteRows } from '@services/google_sheets/sheets';

export const CAMPAIGN_POST_PERFORMANCE_HEADER = [
  'Campaign ID',
  'Campaign Name',
  'Campaign Start Date',
  'Campaign End Date',
  'Creator Name',
  'Creator Username',
  'Platform',
  'Creator Tier',
  'Posting Link',
  'Views',
  'Likes',
  'Comments',
  'Saves',
  'Shares',
  'Engagement Rate',
] as const;

const DATE_FORMAT = 'YYYY-MM-DD';

const platformLabel = (platform: string) =>
  platform === 'tiktok' ? 'TikTok' : platform === 'instagram' ? 'Instagram' : platform;

const usernameForPlatform = (
  platform: string,
  creator:
    | { instagramUser?: { username: string | null } | null; tiktokUser?: { username: string | null } | null }
    | null
    | undefined,
) => (platform === 'tiktok' ? creator?.tiktokUser?.username : creator?.instagramUser?.username) || '';

/**
 * Builds one row per posted link for a campaign: Campaign ID/Name/Start/End, who posted it,
 * their platform/tier, the link, and its latest captured engagement metrics.
 *
 * A creator with posts on both platforms, or more than one video, gets one row per post — the
 * Creator Tier is a per-campaign snapshot on ShortListedCreator, so it repeats across that
 * creator's rows.
 */
export async function getCampaignPostPerformanceRows(campaignId: string): Promise<(string | number)[][]> {
  const [campaign, postingUrls, latestEngagementByPost] = await Promise.all([
    prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { campaignBrief: { select: { startDate: true, endDate: true } } },
    }),
    prisma.submissionPostingUrl.findMany({
      where: { campaignId },
      include: {
        submission: {
          select: {
            userId: true,
            user: {
              select: {
                name: true,
                creator: {
                  select: {
                    instagramUser: { select: { username: true } },
                    tiktokUser: { select: { username: true } },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { postingDate: 'asc' },
    }),
    getLatestCampaignPostEngagement(campaignId),
  ]);

  if (!campaign) throw new Error('Campaign not found');
  if (!postingUrls.length) return [];

  const engagementByPostUrl = new Map(latestEngagementByPost.map((snapshot) => [snapshot.postUrl, snapshot]));

  const userIds = [...new Set(postingUrls.map((p) => p.submission.userId))];
  const shortlisted = await prisma.shortListedCreator.findMany({
    where: { campaignId, userId: { in: userIds } },
    select: { userId: true, creditTier: { select: { name: true } } },
  });
  const tierByUserId = new Map(shortlisted.map((s) => [s.userId, s.creditTier?.name || '']));

  const campaignStart = campaign.campaignBrief?.startDate
    ? dayjs(campaign.campaignBrief.startDate).format(DATE_FORMAT)
    : '';
  const campaignEnd = campaign.campaignBrief?.endDate ? dayjs(campaign.campaignBrief.endDate).format(DATE_FORMAT) : '';

  return postingUrls.map((posting) => {
    const { user } = posting.submission;
    const metrics = engagementByPostUrl.get(posting.postUrl);

    return [
      campaign.id,
      campaign.name,
      campaignStart,
      campaignEnd,
      user?.name || '',
      usernameForPlatform(posting.platform, user?.creator),
      platformLabel(posting.platform),
      tierByUserId.get(posting.submission.userId) || '',
      posting.postUrl,
      metrics?.views ?? 0,
      metrics?.likes ?? 0,
      metrics?.comments ?? 0,
      metrics?.saved ?? 0,
      metrics?.shares ?? 0,
      `${(metrics?.engagementRate ?? 0).toFixed(2)}%`,
    ];
  });
}

const POST_PERFORMANCE_SHEET_TITLE = 'Post Performance';

/**
 * Generates a brand-new spreadsheet with this campaign's post performance rows, and returns its
 * URL. Every call creates a fresh spreadsheet — to update an existing one instead, pass its
 * spreadSheetId to writeCampaignPostPerformance below.
 */
export async function exportCampaignPostPerformance(campaignId: string): Promise<{ rowCount: number; url: string }> {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { name: true } });
  if (!campaign) throw new Error('Campaign not found');

  const rows = await getCampaignPostPerformanceRows(campaignId);

  const { url } = await createSpreadSheetWithData({
    title: `${campaign.name} - Post Performance`,
    sheetTitle: POST_PERFORMANCE_SHEET_TITLE,
    headerRow: [...CAMPAIGN_POST_PERFORMANCE_HEADER],
    rows,
  });

  return { rowCount: rows.length, url };
}

/**
 * Same rows, written into an already-existing spreadsheet's Post Performance tab instead of a
 * new one — for a caller re-running an export it created earlier via exportCampaignPostPerformance.
 * Replaces that tab's rows rather than appending duplicates.
 */
export async function writeCampaignPostPerformance(
  campaignId: string,
  spreadSheetId: string,
): Promise<{ rowCount: number }> {
  const rows = await getCampaignPostPerformanceRows(campaignId);

  await upsertSheetAndWriteRows({
    spreadSheetId,
    sheetTitle: POST_PERFORMANCE_SHEET_TITLE,
    headerRow: [...CAMPAIGN_POST_PERFORMANCE_HEADER],
    rows,
  });

  return { rowCount: rows.length };
}

// How many campaigns' rows to build at once. Each one runs 3-4 queries, so this caps how many
// connections the export borrows from the pool at a time rather than firing them all at once.
const CAMPAIGN_BATCH_SIZE = 5;

const chunk = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

/**
 * Builds post performance rows across every campaign that has at least one posted link —
 * campaigns with none (drafts, campaigns still shortlisting) are skipped rather than emitting an
 * all-zero row. Every row already carries its own Campaign ID/Name, so they read fine combined.
 */
export async function getAllCampaignsPostPerformanceRows(): Promise<(string | number)[][]> {
  const campaignsWithPosts = await prisma.submissionPostingUrl.findMany({
    distinct: ['campaignId'],
    select: { campaignId: true },
  });

  const rows: (string | number)[][] = [];

  for (const batch of chunk(campaignsWithPosts, CAMPAIGN_BATCH_SIZE)) {
    const batchRows = await Promise.all(batch.map(({ campaignId }) => getCampaignPostPerformanceRows(campaignId)));
    rows.push(...batchRows.flat());
  }

  return rows;
}

/**
 * Generates a brand-new spreadsheet with every campaign's post performance rows combined into one
 * tab, and returns its URL. To update it later instead of creating another one, pass its
 * spreadSheetId to writeAllCampaignsPostPerformance below.
 */
export async function exportAllCampaignsPostPerformance(): Promise<{ rowCount: number; url: string }> {
  const rows = await getAllCampaignsPostPerformanceRows();

  const { url } = await createSpreadSheetWithData({
    title: `All Campaigns - Post Performance - ${dayjs().format(DATE_FORMAT)}`,
    sheetTitle: POST_PERFORMANCE_SHEET_TITLE,
    headerRow: [...CAMPAIGN_POST_PERFORMANCE_HEADER],
    rows,
  });

  return { rowCount: rows.length, url };
}

/** Same rows as exportAllCampaignsPostPerformance, written into an existing spreadsheet instead. */
export async function writeAllCampaignsPostPerformance(spreadSheetId: string): Promise<{ rowCount: number }> {
  const rows = await getAllCampaignsPostPerformanceRows();

  await upsertSheetAndWriteRows({
    spreadSheetId,
    sheetTitle: POST_PERFORMANCE_SHEET_TITLE,
    headerRow: [...CAMPAIGN_POST_PERFORMANCE_HEADER],
    rows,
  });

  return { rowCount: rows.length };
}

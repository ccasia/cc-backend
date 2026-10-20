import { LogisticStatus, SubmissionEnum, SubmissionStatus } from '@prisma/client';
import dayjs from 'dayjs';
import { prisma } from '@/src/prisma/prisma';
import { clientCampaignWhere } from '@modules/client-home/client-home.service';
import { CampaignOverview, PerformanceTotals } from './overview.types';
import { toClientUpdate } from './overview.updates';

const UPDATES_LIMIT = 6;
// CampaignLog is mostly admin noise; scan this many recent rows for client-visible ones.
const UPDATES_SCAN = 500;
const PREVIOUS_PERIOD_DAYS = 7;

const CONTENT_TYPES: SubmissionEnum[] = ['VIDEO', 'PHOTO', 'RAW_FOOTAGE', 'FIRST_DRAFT', 'FINAL_DRAFT'];
const V4_POSTABLE_TYPES: SubmissionEnum[] = ['VIDEO', 'PHOTO'];

const SUBMISSION_BUCKETS: Record<
  keyof Omit<CampaignOverview['submissions'], 'submissionVersion' | 'nextDueAt'>,
  SubmissionStatus[]
> = {
  approved: ['CLIENT_APPROVED', 'APPROVED', 'APPROVE_LINK', 'POSTED'],
  inReview: ['SENT_TO_CLIENT'],
  revision: ['CHANGES_REQUIRED', 'CLIENT_FEEDBACK'],
  notSubmitted: ['NOT_STARTED', 'IN_PROGRESS'],
  withAdmins: ['PENDING_REVIEW', 'SENT_TO_ADMIN', 'SENT_TO_SUPERADMIN'],
};

const LOGISTIC_BUCKETS: Record<'delivered' | 'inTransit' | 'awaitingAssignment' | 'issues', LogisticStatus[]> = {
  delivered: ['DELIVERED', 'RECEIVED', 'COMPLETED'],
  inTransit: ['SCHEDULED', 'SHIPPED'],
  awaitingAssignment: ['PENDING_ASSIGNMENT', 'NOT_STARTED'],
  issues: ['ISSUE_REPORTED'],
};

const firstImage = (images: unknown): string | null => {
  if (!Array.isArray(images)) return null;
  const first = images[0];
  return typeof first === 'string' && first ? first : null;
};

/** Sums platforms; engagement rate is averaged weighted by each platform's post count. */
const combine = (
  snapshots: {
    totalPosts: number;
    totalViews: number;
    totalLikes: number;
    totalComments: number;
    averageEngagementRate: number;
  }[],
): PerformanceTotals => {
  const posts = snapshots.reduce((sum, s) => sum + s.totalPosts, 0);
  return {
    views: snapshots.reduce((sum, s) => sum + s.totalViews, 0),
    likes: snapshots.reduce((sum, s) => sum + s.totalLikes, 0),
    comments: snapshots.reduce((sum, s) => sum + s.totalComments, 0),
    engagementRate: posts
      ? snapshots.reduce((sum, s) => sum + s.averageEngagementRate * s.totalPosts, 0) / posts
      : snapshots.reduce((sum, s) => sum + s.averageEngagementRate, 0) / (snapshots.length || 1),
  };
};

const getPerformance = async (campaignId: string): Promise<CampaignOverview['performance']> => {
  const snapshots = await prisma.insightSnapshot.findMany({
    where: { campaignId },
    select: {
      platform: true,
      snapshotDate: true,
      totalPosts: true,
      totalViews: true,
      totalLikes: true,
      totalComments: true,
      averageEngagementRate: true,
    },
    orderBy: { snapshotDate: 'desc' },
  });
  if (!snapshots.length) return null;

  // Each platform's own latest snapshot, and its latest one at least a week older than that.
  const byPlatform = new Map<string, typeof snapshots>();
  for (const s of snapshots) byPlatform.set(s.platform, [...(byPlatform.get(s.platform) ?? []), s]);

  const latest = [...byPlatform.values()].map((rows) => rows[0]);
  const previous = [...byPlatform.values()]
    .map((rows) => {
      const cutoff = dayjs(rows[0].snapshotDate).subtract(PREVIOUS_PERIOD_DAYS, 'day');
      return rows.find((s) => !dayjs(s.snapshotDate).isAfter(cutoff));
    })
    .filter((s): s is (typeof snapshots)[number] => !!s);

  return {
    snapshotDate: new Date(Math.max(...latest.map((s) => s.snapshotDate.getTime()))),
    ...combine(latest),
    previous: previous.length ? combine(previous) : null,
  };
};

const getUpdates = async (campaignId: string): Promise<CampaignOverview['updates']> => {
  const logs = await prisma.campaignLog.findMany({
    where: { campaignId },
    select: { id: true, message: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: UPDATES_SCAN,
  });

  const updates: CampaignOverview['updates'] = [];
  for (const log of logs) {
    const update = toClientUpdate(log.message);
    if (update) updates.push({ id: log.id, createdAt: log.createdAt, ...update });
    if (updates.length === UPDATES_LIMIT) break;
  }
  return updates;
};

/** Null when the user can't see the campaign (or it doesn't exist). */
export const getCampaignOverview = async (userId: string, campaignId: string): Promise<CampaignOverview | null> => {
  const client = await prisma.client.findUnique({ where: { userId }, select: { id: true } });
  if (!client) return null;

  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, ...clientCampaignWhere(userId, client.id) },
    select: {
      id: true,
      name: true,
      status: true,
      submissionVersion: true,
      logisticsType: true,
      campaignCredits: true,
      creditsUtilized: true,
      creditsPending: true,
      campaignBrief: {
        select: {
          objectives: true,
          images: true,
          startDate: true,
          endDate: true,
          postingStartDate: true,
          postingEndDate: true,
        },
      },
    },
  });
  if (!campaign) return null;

  const [
    confirmed,
    contractPending,
    waitingPitches,
    submissionTypes,
    submissionCounts,
    nextDue,
    logisticCounts,
    productCount,
    performance,
    updates,
  ] = await Promise.all([
    // prisma.shortListedCreator.count({ where: { campaignId } }),
    prisma.pitch.count({ where: { outreachStatus: 'CONFIRMED', campaignId } }),
    prisma.pitch.count({ where: { campaignId, status: 'AGREEMENT_PENDING' } }),
    prisma.pitch.findMany({
      where: { campaignId, status: { in: ['SENT_TO_CLIENT', 'AWAITING_APPROVAL'] } },
      select: { createdAt: true, sentToClientAt: true },
    }),
    prisma.submissionType.findMany({ select: { id: true, type: true } }),
    prisma.submission.groupBy({
      by: ['submissionTypeId', 'submissionVersion', 'status'],
      where: { campaignId },
      _count: { _all: true },
    }),
    prisma.submission.findFirst({
      where: { campaignId, status: 'SENT_TO_CLIENT', dueDate: { not: null } },
      orderBy: { dueDate: 'asc' },
      select: { dueDate: true },
    }),
    prisma.logistic.groupBy({ by: ['status'], where: { campaignId }, _count: { _all: true } }),
    prisma.product.count({ where: { campaignId, isArchived: false } }),
    getPerformance(campaignId),
    getUpdates(campaignId),
  ]);

  const typeById = new Map(submissionTypes.map((t) => [t.id, t.type]));
  const submissions = { approved: 0, inReview: 0, revision: 0, notSubmitted: 0, withAdmins: 0 };
  const posts = { live: 0, pending: 0, total: 0 };

  for (const row of submissionCounts) {
    const type = typeById.get(row.submissionTypeId);
    if (!type) continue;
    const count = row._count._all;
    const isV4 = row.submissionVersion === 'v4';

    // Older flow: a final draft is only needed when the first draft got changes, and the
    // unneeded ones sit at NOT_STARTED forever, so they aren't outstanding work.
    const unneededFinalDraft = !isV4 && type === 'FINAL_DRAFT' && row.status === 'NOT_STARTED';
    if (CONTENT_TYPES.includes(type) && !unneededFinalDraft) {
      for (const [bucket, statuses] of Object.entries(SUBMISSION_BUCKETS) as [
        keyof typeof submissions,
        SubmissionStatus[],
      ][]) {
        if (statuses.includes(row.status)) submissions[bucket] += count;
      }
    }

    // v4 posts each video/photo deliverable; the older flow has a separate POSTING submission.
    if (isV4 && V4_POSTABLE_TYPES.includes(type)) {
      posts.total += count;
      if (row.status === 'POSTED') posts.live += count;
      if (['APPROVE_LINK', 'CLIENT_APPROVED', 'APPROVED'].includes(row.status)) posts.pending += count;
    } else if (!isV4 && type === 'POSTING') {
      posts.total += count;
      if (row.status === 'APPROVED') posts.live += count;
      if (row.status === 'PENDING_REVIEW') posts.pending += count;
    }
  }

  const logisticsCount = (statuses: LogisticStatus[]) =>
    logisticCounts.filter((row) => statuses.includes(row.status)).reduce((sum, row) => sum + row._count._all, 0);
  const logisticsTotal = logisticCounts
    .filter((row) => row.status !== 'CANCELLED')
    .reduce((sum, row) => sum + row._count._all, 0);

  const waitingSince = waitingPitches.length
    ? new Date(Math.min(...waitingPitches.map((p) => (p.sentToClientAt ?? p.createdAt).getTime())))
    : null;

  const brief = campaign.campaignBrief;

  return {
    campaign: {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      objective: brief?.objectives ?? null,
      keyArt: firstImage(brief?.images),
      startDate: brief?.startDate ?? null,
      endDate: brief?.endDate ?? null,
      postingStartDate: brief?.postingStartDate ?? null,
      postingEndDate: brief?.postingEndDate ?? null,
    },
    credits: {
      total: campaign.campaignCredits ?? 0,
      used: campaign.creditsUtilized ?? 0,
      unallocated:
        campaign.creditsPending ?? Math.max((campaign.campaignCredits ?? 0) - (campaign.creditsUtilized ?? 0), 0),
    },
    shortlist: { confirmed, contractPending, waitingOnClient: waitingPitches.length, waitingSince },
    submissions: { submissionVersion: campaign.submissionVersion, ...submissions, nextDueAt: nextDue?.dueDate ?? null },
    logistics: {
      enabled: campaign.logisticsType !== null || logisticsTotal > 0,
      type: campaign.logisticsType,
      productsSetUp: productCount > 0,
      delivered: logisticsCount(LOGISTIC_BUCKETS.delivered),
      inTransit: logisticsCount(LOGISTIC_BUCKETS.inTransit),
      awaitingAssignment: logisticsCount(LOGISTIC_BUCKETS.awaitingAssignment),
      issues: logisticsCount(LOGISTIC_BUCKETS.issues),
      total: logisticsTotal,
    },
    posts,
    performance,
    updates,
  };
};

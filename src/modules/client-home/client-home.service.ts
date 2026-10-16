import { CampaignStatus, PitchStatus, Prisma, SubmissionEnum, SubmissionStatus } from '@prisma/client';
import dayjs from 'dayjs';
import { prisma } from '@/src/prisma/prisma';
import { CampaignStage, ClientHome, ClientHomeCampaign, ClientHomeCredits, ClientHomeTask } from './client-home.types';

const TASK_DUE_DAYS = 3;
// Leftover pending items on finished campaigns aren't actionable, so they don't become tasks.
const CLOSED_STATUSES: CampaignStatus[] = ['COMPLETED', 'CANCELLED'];

// Stored SENT_TO_CLIENT is what clients see as "Pending Review"; stored
// PENDING_REVIEW is still with the admins. AWAITING_APPROVAL is the approver flow.
const WAITING_ON_CLIENT: PitchStatus[] = ['SENT_TO_CLIENT', 'AWAITING_APPROVAL'];
const SHORTLIST_PITCH_STATUSES: PitchStatus[] = [...WAITING_ON_CLIENT, 'MAYBE'];

// v4 delivers VIDEO / PHOTO / RAW_FOOTAGE; the older flow delivers FIRST_DRAFT then FINAL_DRAFT
// (a final draft only exists when the first needed changes, so approved ones don't double count).
const CONTENT_TYPES: SubmissionEnum[] = ['VIDEO', 'PHOTO', 'RAW_FOOTAGE', 'FIRST_DRAFT', 'FINAL_DRAFT'];
const V4_POSTABLE_TYPES: SubmissionEnum[] = ['VIDEO', 'PHOTO'];

const RECEIVED_STATUSES: SubmissionStatus[] = [
  'SENT_TO_CLIENT',
  'CLIENT_FEEDBACK',
  'CLIENT_APPROVED',
  'APPROVE_LINK',
  'APPROVED',
  'POSTED',
];
const APPROVED_STATUSES: SubmissionStatus[] = ['CLIENT_APPROVED', 'APPROVE_LINK', 'APPROVED', 'POSTED'];

/** Same campaign scope as getClientCampaigns. */
export const clientCampaignWhere = (userId: string, clientId: string): Prisma.CampaignWhereInput => ({
  OR: [{ campaignAdmin: { some: { adminId: userId } } }, { campaignClients: { some: { clientId } } }],
});

const countBy = <T>(items: T[], key: (item: T) => string) =>
  items.reduce((map, item) => map.set(key(item), (map.get(key(item)) ?? 0) + 1), new Map<string, number>());

const getCompanyCredits = async (companyId: string | null): Promise<ClientHomeCredits> => {
  if (!companyId) return { packageName: null, validUntil: null, total: 0, assigned: 0, used: 0 };

  const subscriptions = await prisma.subscription.findMany({
    where: { companyId, status: 'ACTIVE' },
    select: {
      id: true,
      totalCredits: true,
      creditsUsed: true,
      expiredAt: true,
      package: { select: { name: true } },
      customPackage: { select: { customName: true } },
    },
    orderBy: { expiredAt: 'asc' },
  });

  // Same rule as creditSummary.validityPackageExpiry: the soonest-expiring package with credits left.
  const tracking = subscriptions.find((sub) => (sub.totalCredits || 0) > sub.creditsUsed) ?? null;
  const named = tracking ?? subscriptions[0];

  // Every campaign funded by these packages, not just the ones this client user can see,
  // so total - assigned is what's actually left on the packages.
  const funded = await prisma.campaign.aggregate({
    where: { subscriptionId: { in: subscriptions.map((sub) => sub.id) } },
    _sum: { campaignCredits: true, creditsUtilized: true },
  });

  return {
    packageName: named ? (named.package?.name ?? named.customPackage?.customName ?? null) : null,
    validUntil: tracking?.expiredAt ?? null,
    total: subscriptions.reduce((sum, sub) => sum + (sub.totalCredits || 0), 0),
    assigned: funded._sum.campaignCredits ?? 0,
    used: funded._sum.creditsUtilized ?? 0,
  };
};

const formatNames = (names: string[]) => {
  if (names.length <= 2) return names.join(' and ');
  const others = names.length - 2;
  return `${names.slice(0, 2).join(', ')} and ${others} other${others === 1 ? '' : 's'}`;
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

const stageOf = (
  campaign: Pick<ClientHomeCampaign, 'status' | 'shortlist' | 'submissions' | 'posting'>,
): CampaignStage => {
  const { posting, submissions, shortlist } = campaign;
  if (campaign.status === 'COMPLETED' || (posting.total > 0 && posting.posted >= posting.total)) return 3;
  if (submissions.approved > 0 || posting.posted > 0) return 2;
  if (shortlist.confirmed > 0) return 1;
  return 0;
};

export const getClientHome = async (userId: string): Promise<ClientHome> => {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { name: true, client: { select: { id: true, companyId: true } } },
  });
  const client = user.client!;

  const campaigns = await prisma.campaign.findMany({
    where: clientCampaignWhere(userId, client.id),
    select: {
      id: true,
      name: true,
      status: true,
      submissionVersion: true,
      campaignCredits: true,
      creditsUtilized: true,
      campaignBrief: { select: { objectives: true, endDate: true } },
      brand: { select: { logo: true } },
      company: { select: { logo: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  const campaignIds = campaigns.map((c) => c.id);

  const [companyCredits, shortlisted, pitches, submissionTypes, submissionCounts, sentToClient] = await Promise.all([
    getCompanyCredits(client.companyId),
    prisma.shortListedCreator.groupBy({
      by: ['campaignId'],
      where: { campaignId: { in: campaignIds } },
      _count: { _all: true },
    }),
    prisma.pitch.findMany({
      where: { campaignId: { in: campaignIds }, status: { in: SHORTLIST_PITCH_STATUSES } },
      select: { campaignId: true, status: true, createdAt: true, sentToClientAt: true },
    }),
    prisma.submissionType.findMany({ select: { id: true, type: true } }),
    prisma.submission.groupBy({
      by: ['campaignId', 'submissionTypeId', 'submissionVersion', 'status'],
      where: { campaignId: { in: campaignIds } },
      _count: { _all: true },
    }),
    prisma.submission.findMany({
      where: { campaignId: { in: campaignIds }, status: 'SENT_TO_CLIENT' },
      select: { campaignId: true, updatedAt: true, user: { select: { name: true } } },
    }),
  ]);

  const typeById = new Map(submissionTypes.map((t) => [t.id, t.type]));
  const confirmedBy = new Map(shortlisted.map((row) => [row.campaignId, row._count._all]));
  const shortlistPitchesBy = countBy(pitches, (p) => p.campaignId);

  const statsBy = new Map<string, Pick<ClientHomeCampaign, 'submissions' | 'posting'>>();
  for (const row of submissionCounts) {
    const type = typeById.get(row.submissionTypeId);
    if (!type) continue;

    const stats = statsBy.get(row.campaignId) ?? {
      submissions: { received: 0, approved: 0 },
      posting: { posted: 0, total: 0 },
    };
    statsBy.set(row.campaignId, stats);
    const count = row._count._all;

    if (CONTENT_TYPES.includes(type)) {
      if (RECEIVED_STATUSES.includes(row.status)) stats.submissions.received += count;
      if (APPROVED_STATUSES.includes(row.status)) stats.submissions.approved += count;
    }

    // v4 posts each video/photo deliverable directly; the older flow has a separate POSTING submission.
    if (row.submissionVersion === 'v4') {
      if (V4_POSTABLE_TYPES.includes(type)) {
        stats.posting.total += count;
        if (row.status === 'POSTED') stats.posting.posted += count;
      }
    } else if (type === 'POSTING') {
      stats.posting.total += count;
      if (row.status === 'APPROVED') stats.posting.posted += count;
    }
  }

  const homeCampaigns: ClientHomeCampaign[] = campaigns.map((campaign) => {
    const confirmed = confirmedBy.get(campaign.id) ?? 0;
    const base = {
      status: campaign.status,
      shortlist: { confirmed, total: confirmed + (shortlistPitchesBy.get(campaign.id) ?? 0) },
      ...(statsBy.get(campaign.id) ?? { submissions: { received: 0, approved: 0 }, posting: { posted: 0, total: 0 } }),
    };

    return {
      id: campaign.id,
      name: campaign.name,
      objective: campaign.campaignBrief?.objectives ?? null,
      endDate: campaign.campaignBrief?.endDate ?? null,
      logo: campaign.brand?.logo ?? campaign.company?.logo ?? null,
      submissionVersion: campaign.submissionVersion,
      stage: stageOf(base),
      credits: { used: campaign.creditsUtilized ?? 0, assigned: campaign.campaignCredits ?? 0 },
      ...base,
    };
  });

  const tasks: ClientHomeTask[] = [];
  const makeTask = (task: Omit<ClientHomeTask, 'id' | 'dueAt'>): ClientHomeTask => ({
    id: `${task.type}:${task.campaignId}`,
    ...task,
    dueAt: dayjs(task.sentAt).add(TASK_DUE_DAYS, 'day').toDate(),
  });
  const earliest = (dates: Date[]) => new Date(Math.min(...dates.map((d) => d.getTime())));

  const taskCampaignIds = campaigns.filter((c) => !CLOSED_STATUSES.includes(c.status)).map((c) => c.id);

  for (const campaignId of taskCampaignIds) {
    // sentToClientAt is set by a DB trigger; rows from before it existed fall back to createdAt.
    const waiting = pitches.filter((p) => p.campaignId === campaignId && WAITING_ON_CLIENT.includes(p.status!));
    if (waiting.length) {
      tasks.push(
        makeTask({
          type: 'SHORTLIST_REVIEW',
          campaignId,
          title: 'Confirm your creator shortlist',
          detail: `${plural(waiting.length, 'creator')} proposed`,
          count: waiting.length,
          sentAt: earliest(waiting.map((p) => p.sentToClientAt ?? p.createdAt)),
        }),
      );
    }

    const content = sentToClient.filter((s) => s.campaignId === campaignId);
    if (content.length) {
      const names = [...new Set(content.map((s) => s.user.name?.trim()).filter((n): n is string => !!n))];
      tasks.push(
        makeTask({
          type: 'CONTENT_REVIEW',
          campaignId,
          title: `Approve ${plural(content.length, 'content submission')}`,
          detail: names.length ? `From ${formatNames(names)}` : '',
          count: content.length,
          sentAt: earliest(content.map((s) => s.updatedAt)),
        }),
      );
    }
  }

  return {
    greetingName: user.name?.trim().split(/\s+/)[0] || null,
    credits: companyCredits,
    campaigns: homeCampaigns,
    tasks,
  };
};

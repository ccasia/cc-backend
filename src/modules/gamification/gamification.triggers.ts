import { PrismaClient } from '@prisma/client';
import { awardXp, progressAchievement } from './gamification.service';

const prisma = new PrismaClient();

type SubmissionSubmittedInput = {
  submissionId: string;
  userId: string;
  campaignId: string;
  submissionType?: string | null;
};

export const onSubmissionSubmitted = ({
  submissionId,
  userId,
  campaignId,
  submissionType,
}: SubmissionSubmittedInput): void => {
  if (submissionType === 'AGREEMENT_FORM') return;

  void awardXp({
    userId,
    actionCode: 'submission_submitted',
    sourceId: submissionId,
    metadata: { submissionId, campaignId, type: submissionType },
  });
  void progressAchievement({ userId, code: 'first-drop', sourceId: submissionId });

  const hourMYT = new Date(Date.now() + 8 * 60 * 60 * 1000).getUTCHours();
  if (hourMYT <= 5) {
    void progressAchievement({ userId, code: 'night-owl', sourceId: submissionId });
  }

  void progressQuickTurn(userId, campaignId, submissionId);
};

type PitchSubmittedInput = {
  userId: string;
  campaignId: string;
  pitchId: string;
};

/**
 * A creator submitted a new pitch (edits don't reach here).
 */
export const onPitchSubmitted = ({ userId, campaignId, pitchId }: PitchSubmittedInput): void => {
  void awardXp({ userId, actionCode: 'pitch_submitted', sourceId: campaignId });
  void progressAchievement({ userId, code: 'pitch-perfect', sourceId: campaignId });
  void progressFirstMover(userId, campaignId, pitchId);
};

/**
 * "Be the first creator to pitch on a brand new campaign", 5 times. Counts pitches
 * on this campaign excluding the creator's own — zero means they got there first.
 * sourceId is the campaign, so each campaign can only contribute once.
 */
const progressFirstMover = async (userId: string, campaignId: string, pitchId: string): Promise<void> => {
  try {
    const others = await prisma.pitch.count({
      where: { campaignId, userId: { not: userId } },
    });

    if (others === 0) {
      void progressAchievement({ userId, code: 'first-mover', sourceId: campaignId });
    }
  } catch (error) {
    console.error(`[gamification] first-mover check failed for ${userId}/${pitchId}:`, error);
  }
};

export const onInvoicePaid = (creatorId: string): void => {
  void progressSideHustle(creatorId);
};

const progressSideHustle = async (creatorId: string): Promise<void> => {
  try {
    const paid = await prisma.invoice.aggregate({
      where: { creatorId, status: 'paid' },
      _sum: { amount: true },
    });

    const total = Math.floor(paid._sum.amount ?? 0);
    if (total <= 0) return;

    const earned = await prisma.creatorAchievementEvent.aggregate({
      where: { userId: creatorId, creatorAchievement: { achievement: { code: 'side-hustle' } } },
      _sum: { increment: true },
    });

    const delta = total - (earned._sum.increment ?? 0);
    if (delta > 0) {
      void progressAchievement({
        userId: creatorId,
        code: 'side-hustle',
        sourceId: `total-${total}`,
        increment: delta,
      });
    }
  } catch (error) {
    console.error(`[gamification] side-hustle check failed for ${creatorId}:`, error);
  }
};

/**
 * The creator was shortlisted for a campaign.
 */
export const onShortlisted = (userId: string, campaignId: string): void => {
  void awardXp({
    userId,
    actionCode: 'shortlisted',
    sourceId: `${userId}:${campaignId}`,
    metadata: { campaignId },
  });
  void progressAchievement({ userId, code: 'overachiever', sourceId: `${userId}:${campaignId}` });
  void progressShowrunner(userId, campaignId);
};

const progressShowrunner = async (userId: string, campaignId: string): Promise<void> => {
  try {
    const now = new Date();

    const concurrent = await prisma.shortListedCreator.count({
      where: {
        userId,
        isCampaignDone: false,
        campaign: {
          campaignBrief: { startDate: { lte: now }, endDate: { gte: now } },
        },
      },
    });

    if (concurrent >= 3) {
      void progressAchievement({ userId, code: 'showrunner', sourceId: campaignId });
    }
  } catch (error) {
    console.error(`[gamification] showrunner check failed for ${userId}/${campaignId}:`, error);
  }
};

type MediaKitPlatform = 'instagram' | 'tiktok';

export const onMediaKitConnected = (userId: string, platform: MediaKitPlatform): void => {
  void awardXp({ userId, actionCode: 'connecting_media_kit', sourceId: platform });
  void progressAchievement({ userId, code: 'media-kitter', sourceId: platform });
};

type PostSnapshotInput = {
  userId: string;
  submissionId: string;
  views: number;
};

export const onPostSnapshot = ({ userId, submissionId, views }: PostSnapshotInput): void => {
  if (views < CROWD_PLEASER_VIEWS) return;

  void progressAchievement({
    userId,
    code: 'crowd-pleaser',
    sourceId: submissionId,
    increment: CROWD_PLEASER_VIEWS,
  });
};

const CROWD_PLEASER_VIEWS = 50_000;

const QUICK_TURN_WINDOW_MS = 72 * 60 * 60 * 1000;

/**
 * "Submit a campaign submission within 72 hours of being shortlisted" — measured
 * from shortlisted_date on the creator's row for this campaign.
 */
const progressQuickTurn = async (userId: string, campaignId: string, submissionId: string): Promise<void> => {
  try {
    const shortlist = await prisma.shortListedCreator.findUnique({
      where: { userId_campaignId: { userId, campaignId } },
      select: { shortlisted_date: true },
    });

    if (!shortlist?.shortlisted_date) return;

    if (Date.now() - shortlist.shortlisted_date.getTime() <= QUICK_TURN_WINDOW_MS) {
      void progressAchievement({ userId, code: 'quick-turn', sourceId: submissionId });
    }
  } catch (error) {
    console.error(`[gamification] quick-turn check failed for ${userId}/${campaignId}:`, error);
  }
};

type CampaignCompletedInput = {
  userId: string;
  campaignId: string;
  companyId?: string | null;
};

export const onCampaignCompleted = ({ userId, campaignId }: CampaignCompletedInput): void => {
  void progressAchievement({ userId, code: 'cult-legend', sourceId: campaignId });
};

type AgreementApprovedInput = {
  userId: string;
  campaignId: string;
};

export const onAgreementApproved = ({ userId, campaignId }: AgreementApprovedInput): void => {
  void progressEncore(userId, campaignId);
};

const progressEncore = async (userId: string, campaignId: string): Promise<void> => {
  try {
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { companyId: true, brandId: true },
    });

    const companyId = campaign?.companyId ?? campaign?.brandId;
    if (!companyId) return;

    const approvedAgreements = await prisma.submission.findMany({
      where: {
        userId,
        status: 'APPROVED',
        submissionType: { type: 'AGREEMENT_FORM' },
        campaign: { OR: [{ companyId }, { brandId: companyId }] },
      },
      select: { campaignId: true },
      distinct: ['campaignId'],
    });

    if (approvedAgreements.length >= 2) {
      void progressAchievement({ userId, code: 'encore', sourceId: companyId });
    }
  } catch (error) {
    console.error(`[gamification] encore check failed for ${userId}/${campaignId}:`, error);
  }
};

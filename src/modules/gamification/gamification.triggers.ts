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

export const onCampaignCompleted = ({ userId, campaignId, companyId }: CampaignCompletedInput): void => {
  void progressAchievement({ userId, code: 'cult-legend', sourceId: campaignId });

  if (companyId) {
    void progressEncore(userId, campaignId, companyId);
  }
};

const progressEncore = async (userId: string, campaignId: string, companyId: string): Promise<void> => {
  try {
    const count = await prisma.shortListedCreator.count({
      where: {
        userId,
        isCampaignDone: true,
        campaign: { OR: [{ companyId }, { brandId: companyId }] },
      },
    });

    if (count >= 2) {
      void progressAchievement({ userId, code: 'encore', sourceId: companyId });
    }
  } catch (error) {
    console.error(`[gamification] encore check failed for ${userId}/${campaignId}:`, error);
  }
};

import { PrismaClient } from '@prisma/client';
import { createInvoiceService } from './invoiceService';
import { saveNotification } from '../controller/notificationController';
import { clients, getIo } from '../config/socket';
import {
  CREATOR_CAMPAIGN_COMPLETED_EVENT,
  createCreatorCampaignCompletedPayload,
} from '@utils/campaignCompletionEvents';
import { getEffectiveCampaignOrigin } from '@utils/campaignFlow';
import { onCampaignCompleted } from '@/src/modules/gamification';

const prisma = new PrismaClient();

/**
 * Interface for completion status result
 */
interface CompletionStatus {
  isComplete: boolean;
  reason: string;
  missingDeliverables: string[];
}

interface RoundVideoRange {
  round: number;
  start: number;
  end: number;
}

/**
 * The cumulative VIDEO contentOrder range each sent agreement round owns, oldest round
 * first — round 1 owns 1..N1, round 2 owns (N1+1)..(N1+N2), etc. Mirrors how
 * appendAdditionalAgreementSubmissions numbers new VIDEO submissions when a round is sent.
 */
async function getRoundVideoRanges(campaignId: string, userId: string): Promise<RoundVideoRange[]> {
  const agreements = await prisma.creatorAgreement.findMany({
    where: { campaignId, userId, isSent: true },
    orderBy: { round: 'asc' },
    select: { round: true, videoCount: true },
  });

  let cursor = 0;
  return agreements.map((a) => {
    const count = a.videoCount ?? 0;
    const start = cursor + 1;
    cursor += count;
    return { round: a.round, start, end: cursor };
  });
}

/** Which round a VIDEO submission's contentOrder belongs to (PHOTO/RAW_FOOTAGE are single, one-time deliverables that always belong to round 1). */
function roundForContentOrder(ranges: RoundVideoRange[], contentOrder: number | null | undefined): number {
  if (contentOrder == null) return 1;
  return ranges.find((r) => contentOrder >= r.start && contentOrder <= r.end)?.round ?? 1;
}

/**
 * Check if all V4 deliverables are complete for a creator in a campaign
 * This function implements the completion criteria specified:
 *
 * For normal campaigns:
 * 1. Video submissions (if any) must be POSTED
 * 2. Photo submissions (if any) must be POSTED
 * 3. Raw Footage submissions (if any) must be fully approved
 *
 * For UGC campaigns:
 * All submissions must be fully approved (posting links not required)
 *
 * "Fully approved" is CLIENT_APPROVED on campaigns with a client; on campaigns
 * without one, admin approval (APPROVED) is final.
 */
export const checkV4SubmissionCompletion = async (
  campaignId: string,
  userId: string,
  round?: number,
): Promise<CompletionStatus> => {
  try {
    console.log(`Checking V4 completion for user ${userId} in campaign ${campaignId}, round ${round ?? '(latest)'}`);

    // Get campaign details and all V4 submissions for the user
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      include: {
        shortlisted: {
          where: { userId },
          select: {
            isCampaignDone: true,
            ugcVideos: true,
          },
        },
        campaignAdmin: {
          include: {
            admin: {
              include: {
                user: { select: { role: true } },
                role: true,
              },
            },
          },
        },
      },
    });

    if (!campaign) {
      return {
        isComplete: false,
        reason: 'Campaign not found',
        missingDeliverables: [],
      };
    }

    const shortlistedCreator = campaign.shortlisted[0];
    if (!shortlistedCreator) {
      return {
        isComplete: false,
        reason: 'Creator not found in campaign',
        missingDeliverables: [],
      };
    }


    // Get all V4 content submissions (excluding agreement forms)
    const submissions = await prisma.submission.findMany({
      where: {
        campaignId,
        userId,
        submissionVersion: 'v4',
        submissionType: {
          type: {
            in: ['VIDEO', 'PHOTO', 'RAW_FOOTAGE'],
          },
        },
      },
      include: {
        submissionType: true,
      },
      orderBy: [{ submissionType: { type: 'asc' } }, { contentOrder: 'asc' }],
    });

    console.log(`📋 Found ${submissions.length} V4 content submissions for user ${userId}`);

    if (submissions.length === 0) {
      return {
        isComplete: false,
        reason: 'No content submissions found',
        missingDeliverables: [],
      };
    }

    const ranges = await getRoundVideoRanges(campaignId, userId);
    const targetRound = round ?? ranges[ranges.length - 1]?.round ?? 1;
    const targetRange = ranges.find((r) => r.round === targetRound);

    if (!targetRange) {
      return {
        isComplete: false,
        reason: `No sent agreement found for round ${targetRound}`,
        missingDeliverables: [],
      };
    }

    const isUGCCampaign = campaign.campaignType === 'ugc';
    const missingDeliverables: string[] = [];
    let allComplete = true;

    // Terminal approval status depends on the flow: campaigns with a client end at
    // CLIENT_APPROVED; campaigns without one end at APPROVED (admin approval is final).
    // On client campaigns APPROVED alone must NOT complete (client review still pending).
    const hasClientFlow = getEffectiveCampaignOrigin(campaign) === 'CLIENT';
    const approvedStatuses: string[] = hasClientFlow ? ['CLIENT_APPROVED'] : ['CLIENT_APPROVED', 'APPROVED'];

    // Group submissions by type for easier analysis
    const videoSubmissions = submissions.filter(
      (s) =>
        s.submissionType.type === 'VIDEO' &&
        targetRange &&
        (s.contentOrder ?? 0) >= targetRange.start &&
        (s.contentOrder ?? 0) <= targetRange.end,
    );
    const photoSubmissions = targetRound === 1 ? submissions.filter((s) => s.submissionType.type === 'PHOTO') : [];
    const rawFootageSubmissions =
      targetRound === 1 ? submissions.filter((s) => s.submissionType.type === 'RAW_FOOTAGE') : [];

    console.log(
      `📊 Submission breakdown - Videos: ${videoSubmissions.length}, Photos: ${photoSubmissions.length}, Raw Footage: ${rawFootageSubmissions.length}`,
    );
    console.log(`🏷️  Campaign type: ${campaign.campaignType} (UGC: ${isUGCCampaign})`);

    if (isUGCCampaign) {
      // For UGC campaigns: All submissions must be CLIENT_APPROVED
      console.log(`🎬 Checking UGC campaign completion - all submissions must be CLIENT_APPROVED`);

      // Check video submissions
      for (const submission of videoSubmissions) {
        if (!approvedStatuses.includes(submission.status)) {
          allComplete = false;
          missingDeliverables.push(`Video ${submission.contentOrder} (current: ${submission.status})`);
        }
      }

      // Check photo submissions
      for (const submission of photoSubmissions) {
        if (!approvedStatuses.includes(submission.status)) {
          allComplete = false;
          missingDeliverables.push(`Photos (current: ${submission.status})`);
        }
      }

      // Check raw footage submissions
      for (const submission of rawFootageSubmissions) {
        if (!approvedStatuses.includes(submission.status)) {
          allComplete = false;
          missingDeliverables.push(`Raw Footage (current: ${submission.status})`);
        }
      }
    } else {
      // For normal campaigns: Videos and Photos must be POSTED, Raw Footage must be CLIENT_APPROVED
      console.log(
        `📱 Checking normal campaign completion - Videos/Photos must be POSTED, Raw Footage must be CLIENT_APPROVED`,
      );

      // Check video submissions - must be POSTED
      for (const submission of videoSubmissions) {
        if (submission.status !== 'POSTED') {
          allComplete = false;
          missingDeliverables.push(`Video ${submission.contentOrder} posting (current: ${submission.status})`);
        }
      }

      // Check photo submissions - must be POSTED
      for (const submission of photoSubmissions) {
        if (submission.status !== 'POSTED') {
          allComplete = false;
          missingDeliverables.push(`Photos posting (current: ${submission.status})`);
        }
      }

      // Check raw footage submissions - must be fully approved (client or admin-final)
      for (const submission of rawFootageSubmissions) {
        if (!approvedStatuses.includes(submission.status)) {
          allComplete = false;
          missingDeliverables.push(`Raw Footage approval (current: ${submission.status})`);
        }
      }
    }

    const completionStatus: CompletionStatus = {
      isComplete: allComplete,
      reason: allComplete
        ? `All deliverables complete for ${isUGCCampaign ? 'UGC' : 'normal'} campaign`
        : `Missing deliverables: ${missingDeliverables.join(', ')}`,
      missingDeliverables,
    };

    console.log(`📋 V4 Completion check result for user ${userId}:`, completionStatus);

    return completionStatus;
  } catch (error) {
    console.error('Error checking V4 submission completion:', error);
    return {
      isComplete: false,
      reason: `Error checking completion: ${error instanceof Error ? error.message : 'Unknown error'}`,
      missingDeliverables: [],
    };
  }
};

/**
 * Handle V4 campaign completion - mark as done and generate invoice
 * This should be called whenever a V4 submission status changes to a potentially completing status
 */
export const handleV4CompletedCampaign = async (
  campaignId: string,
  userId: string,
  adminId?: string,
  round?: number,
): Promise<boolean> => {
  try {
    const ranges = await getRoundVideoRanges(campaignId, userId);
    const targetRound = round ?? ranges[ranges.length - 1]?.round ?? 1;
    const isLatestRound = targetRound === (ranges[ranges.length - 1]?.round ?? 1);

    // Check if this specific round is actually complete
    const completionStatus = await checkV4SubmissionCompletion(campaignId, userId, targetRound);

    if (!completionStatus.isComplete) {
      console.log(`⏳ Round ${targetRound} not yet complete: ${completionStatus.reason}`);
      return false;
    }

    // Get creator and campaign data for invoice generation
    const creatorData = await prisma.shortListedCreator.findFirst({
      where: {
        campaignId,
        userId,
      },
      include: {
        user: {
          include: {
            creator: true,
            paymentForm: true,
            creatorAgreement: {
              where: { campaignId, round: targetRound },
            },
          },
        },
        campaign: {
          include: {
            campaignBrief: true,
          },
        },
      },
    });

    if (!creatorData) {
      throw new Error('Creator data not found');
    }

    if (!creatorData.user) {
      throw new Error('Creator user data not found');
    }

    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { campaignType: true } });

    const isSeedingCampaign = campaign?.campaignType === 'seedingCampaign';

    // Check if this round was already invoiced, to prevent duplicates (not the blanket
    const existingInvoice = await prisma.invoice.findFirst({
      where: { campaignId, creatorId: userId, round: targetRound },
      select: { id: true },
    });
    if (existingInvoice) {
      return true;
    }

    // Get creator agreement amount for invoice
    const creatorAgreement = creatorData.user.creatorAgreement?.[0];

    if (!creatorAgreement) {
      throw new Error('Creator agreement not found');
    }

    let invoice: any;
    if (!isSeedingCampaign) {
      // Create invoice using existing service
      invoice = await createInvoiceService(
        {
          user: creatorData.user,
          campaignId,
          updatedAt: new Date(),
          round: targetRound,
        },
        userId,
        creatorAgreement.amount,
        undefined, // invoiceItems - V4 doesn't use detailed items
        undefined, // tx - not in transaction
        adminId,
      );

      getIo().to(campaignId).emit('v4:invoice:generated', {
        campaignId,
        creatorId: userId,
        round: targetRound,
        invoiceId: invoice?.id,
      });
    }

    if (isLatestRound) {
      await prisma.shortListedCreator.update({
        where: {
          userId_campaignId: {
            userId,
            campaignId,
          },
        },
        data: {
          isCampaignDone: true,
        },
      });
    }

    // Notify the creator's app so the campaign moves from Active to Done in real time
    const completedPayload = createCreatorCampaignCompletedPayload({ userId, campaignId });

    const creatorSocketId = clients.get(userId);

    if (creatorSocketId) {
      getIo().to(creatorSocketId).emit(CREATOR_CAMPAIGN_COMPLETED_EVENT, completedPayload);
    }
    getIo().to(campaignId).emit(CREATOR_CAMPAIGN_COMPLETED_EVENT, completedPayload);

    // Notify the creator their posting is approved and the invoice is ready (in-app + push)
    if (invoice?.id && !isSeedingCampaign) {
      const creatorNotification = await saveNotification({
        userId,
        title: '✅ Posting Approved',
        message: `Your ${creatorData.campaign.name} posting is approved - invoice's ready inside`,
        entity: 'Invoice',
        invoiceId: invoice.id,
        entityId: campaignId,
      });

      if (creatorSocketId) {
        getIo().to(creatorSocketId).emit('notification', creatorNotification);
      }
    } else if (isSeedingCampaign) {
      const creatorNotification = await saveNotification({
        userId,
        title: '✅ Posting Approved',
        message: `Your ${creatorData.campaign.name} posting is approved`,
        entity: 'Posting',
        entityId: campaignId,
      });

      if (creatorSocketId) {
        getIo().to(creatorSocketId).emit('notification', creatorNotification);
      }
    }

    // TODO: Send email notification (similar to V3 flow)

    onCampaignCompleted({
      userId,
      campaignId,
    });

    return true;
  } catch (error) {
    console.error('Error handling V4 campaign completion:', error);
    throw error;
  }
};

/**
 * Check and potentially complete campaign after a status change
 * This is the main entry point that should be called from V4 controllers
 */
export const checkAndCompleteV4Campaign = async (submissionId: string, adminId?: string): Promise<void> => {
  try {
    // Get submission details
    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      select: {
        campaignId: true,
        userId: true,
        status: true,
        submissionVersion: true,
        contentOrder: true,
      },
    });

    if (!submission) {
      console.log(`⚠️  Submission ${submissionId} not found`);
      return;
    }

    if (submission.submissionVersion !== 'v4') {
      console.log(`⚠️  Submission ${submissionId} is not V4, skipping completion check`);
      return;
    }

    // Only check completion for potentially completing statuses.
    // APPROVED is included as a trigger for no-client campaigns where admin approval is
    // final; checkV4SubmissionCompletion still enforces CLIENT_APPROVED on client campaigns.
    const completingStatuses = ['POSTED', 'CLIENT_APPROVED', 'APPROVED'];
    if (!completingStatuses.includes(submission.status)) {
      console.log(`⏳ Submission ${submissionId} status ${submission.status} not a completing status, skipping`);
      return;
    }

    console.log(`🔄 Checking V4 campaign completion for submission ${submissionId} with status ${submission.status}`);

    const ranges = await getRoundVideoRanges(submission.campaignId, submission.userId);
    const round = roundForContentOrder(ranges, submission.contentOrder);

    // Attempt to complete the campaign
    await handleV4CompletedCampaign(submission.campaignId, submission.userId, adminId, round);
  } catch (error) {
    console.error('Error in checkAndCompleteV4Campaign:', error);
    // Don't throw - we don't want submission approval to fail if completion check fails
  }
};

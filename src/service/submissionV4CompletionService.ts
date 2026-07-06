import { PrismaClient } from '@prisma/client';
import { createInvoiceService } from './invoiceService';
import { saveNotification } from '../controller/notificationController';
import { clients, io } from '../server';
import {
  CREATOR_CAMPAIGN_COMPLETED_EVENT,
  createCreatorCampaignCompletedPayload,
} from '@utils/campaignCompletionEvents';

const prisma = new PrismaClient();

/**
 * Interface for completion status result
 */
interface CompletionStatus {
  isComplete: boolean;
  reason: string;
  missingDeliverables: string[];
}

/**
 * Check if all V4 deliverables are complete for a creator in a campaign
 * This function implements the completion criteria specified:
 *
 * For normal campaigns:
 * 1. Video submissions (if any) must be POSTED
 * 2. Photo submissions (if any) must be POSTED
 * 3. Raw Footage submissions (if any) must be CLIENT_APPROVED
 *
 * For UGC campaigns:
 * All submissions must be CLIENT_APPROVED (posting links not required)
 */
export const checkV4SubmissionCompletion = async (campaignId: string, userId: string): Promise<CompletionStatus> => {
  try {
    console.log(`🔍 Checking V4 completion for user ${userId} in campaign ${campaignId}`);

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

    // Skip if already marked as done
    if (shortlistedCreator.isCampaignDone) {
      console.log(`✅ Campaign already marked as complete for user ${userId}`);
      return {
        isComplete: true,
        reason: 'Already completed',
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

    const isUGCCampaign = campaign.campaignType === 'ugc';
    const missingDeliverables: string[] = [];
    let allComplete = true;

    // Group submissions by type for easier analysis
    const videoSubmissions = submissions.filter((s) => s.submissionType.type === 'VIDEO');
    const photoSubmissions = submissions.filter((s) => s.submissionType.type === 'PHOTO');
    const rawFootageSubmissions = submissions.filter((s) => s.submissionType.type === 'RAW_FOOTAGE');

    console.log(
      `📊 Submission breakdown - Videos: ${videoSubmissions.length}, Photos: ${photoSubmissions.length}, Raw Footage: ${rawFootageSubmissions.length}`,
    );
    console.log(`🏷️  Campaign type: ${campaign.campaignType} (UGC: ${isUGCCampaign})`);

    if (isUGCCampaign) {
      // For UGC campaigns: All submissions must be CLIENT_APPROVED
      console.log(`🎬 Checking UGC campaign completion - all submissions must be CLIENT_APPROVED`);

      // Check video submissions
      for (const submission of videoSubmissions) {
        if (submission.status !== 'CLIENT_APPROVED') {
          allComplete = false;
          missingDeliverables.push(`Video ${submission.contentOrder} (current: ${submission.status})`);
        }
      }

      // Check photo submissions
      for (const submission of photoSubmissions) {
        if (submission.status !== 'CLIENT_APPROVED') {
          allComplete = false;
          missingDeliverables.push(`Photos (current: ${submission.status})`);
        }
      }

      // Check raw footage submissions
      for (const submission of rawFootageSubmissions) {
        if (submission.status !== 'CLIENT_APPROVED') {
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

      // Check raw footage submissions - must be CLIENT_APPROVED
      for (const submission of rawFootageSubmissions) {
        if (submission.status !== 'CLIENT_APPROVED') {
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
): Promise<boolean> => {
  try {
    console.log(`🎯 Handling V4 campaign completion for user ${userId} in campaign ${campaignId}`);

    // Check if campaign is actually complete
    const completionStatus = await checkV4SubmissionCompletion(campaignId, userId);

    if (!completionStatus.isComplete) {
      console.log(`⏳ Campaign not yet complete: ${completionStatus.reason}`);
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
              where: { campaignId },
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

    // Check if already processed to prevent duplicates
    if (creatorData.isCampaignDone) {
      console.log(`✅ Campaign already marked as complete for user ${userId}`);
      return true;
    }

    // Get creator agreement amount for invoice
    const creatorAgreement = creatorData.user.creatorAgreement?.[0];
    if (!creatorAgreement) {
      throw new Error('Creator agreement not found');
    }

    console.log(`💰 Creating invoice for ${creatorAgreement.amount} for creator ${userId}`);

    // Create invoice using existing service
    const invoice = await createInvoiceService(
      {
        user: creatorData.user,
        campaignId,
        updatedAt: new Date(),
      },
      userId,
      creatorAgreement.amount,
      undefined, // invoiceItems - V4 doesn't use detailed items
      undefined, // tx - not in transaction
      adminId,
    );

    // Mark campaign as done
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

    console.log(`✅ V4 Campaign completed for user ${userId} - invoice generated: ${invoice?.id}`);

    // Notify the creator's app so the campaign moves from Active to Done in real time
    const completedPayload = createCreatorCampaignCompletedPayload({ userId, campaignId });
    const creatorSocketId = clients.get(userId);
    if (creatorSocketId) {
      io.to(creatorSocketId).emit(CREATOR_CAMPAIGN_COMPLETED_EVENT, completedPayload);
    }
    io.to(campaignId).emit(CREATOR_CAMPAIGN_COMPLETED_EVENT, completedPayload);

    // Notify the creator their posting is approved and the invoice is ready (in-app + push)
    if (invoice?.id) {
      const creatorNotification = await saveNotification({
        userId,
        title: '✅ Posting Approved',
        message: `Your ${creatorData.campaign.name} posting is approved - invoice's ready inside`,
        entity: 'Invoice',
        invoiceId: invoice.id,
        entityId: campaignId,
      });

      if (creatorSocketId) {
        io.to(creatorSocketId).emit('notification', creatorNotification);
      }
    }

    // TODO: Send email notification (similar to V3 flow)

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

    // Only check completion for potentially completing statuses
    const completingStatuses = ['POSTED', 'CLIENT_APPROVED'];
    if (!completingStatuses.includes(submission.status)) {
      console.log(`⏳ Submission ${submissionId} status ${submission.status} not a completing status, skipping`);
      return;
    }

    console.log(`🔄 Checking V4 campaign completion for submission ${submissionId} with status ${submission.status}`);

    // Attempt to complete the campaign
    await handleV4CompletedCampaign(submission.campaignId, submission.userId, adminId);
  } catch (error) {
    console.error('Error in checkAndCompleteV4Campaign:', error);
    // Don't throw - we don't want submission approval to fail if completion check fails
  }
};

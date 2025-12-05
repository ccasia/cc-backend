import { Request, Response } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import { logAdminChange } from '@services/campaignServices';

const prisma = new PrismaClient();

/**
 * Swap a guest creator with an existing platform creator
 *
 * This endpoint:
 * 1. Updates all references from guest user to real user
 * 2. Deletes the orphaned guest user and creator records
 * 3. Maintains data integrity across all related tables
 *
 * POST /api/campaign/swapCreator
 * Body: { campaignId, guestUserId, platformUserId }
 */
export const swapGuestWithPlatformCreator = async (req: Request, res: Response) => {
  const { campaignId, guestUserId, platformUserId } = req.body;
  const adminId = req.session.userid;

  // Validate input
  if (!campaignId || !guestUserId || !platformUserId) {
    return res.status(400).json({
      message: 'Campaign ID, guest user ID, and platform user ID are required.',
    });
  }

  if (guestUserId === platformUserId) {
    return res.status(400).json({
      message: 'Guest user and platform user cannot be the same.',
    });
  }

  try {
    // Validate campaign exists
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, name: true },
    });

    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found.' });
    }

    // Validate guest user exists and is actually a guest
    const guestUser = await prisma.user.findUnique({
      where: { id: guestUserId },
      include: { creator: true },
    });

    if (!guestUser) {
      return res.status(404).json({ message: 'Guest user not found.' });
    }

    if (guestUser.status !== 'guest' || !guestUser.creator?.isGuest) {
      return res.status(400).json({
        message: 'The specified user is not a guest creator.',
      });
    }

    // Validate platform user exists and is active
    const platformUser = await prisma.user.findUnique({
      where: { id: platformUserId },
      include: { creator: true },
    });

    if (!platformUser) {
      return res.status(404).json({ message: 'Platform creator not found.' });
    }

    if (platformUser.status !== 'active') {
      return res.status(400).json({
        message: 'Platform creator must be active to be assigned to campaigns.',
      });
    }

    if (!platformUser.creator || platformUser.creator.isGuest) {
      return res.status(400).json({
        message: 'The specified user is not a valid platform creator.',
      });
    }

    // Check if platform creator is already shortlisted for this campaign
    const existingShortlist = await prisma.shortListedCreator.findUnique({
      where: {
        userId_campaignId: {
          userId: platformUserId,
          campaignId,
        },
      },
    });

    if (existingShortlist) {
      return res.status(400).json({
        message: 'This platform creator is already shortlisted for this campaign.',
      });
    }

    // Perform the swap in a transaction
    const result = await prisma.$transaction(async (tx) => {
      console.log(
        `[SWAP] Starting swap: Guest ${guestUserId} -> Platform ${platformUserId} for campaign ${campaignId}`,
      );

      // 1. Get guest creator's current data before swap
      const guestShortlist = await tx.shortListedCreator.findUnique({
        where: {
          userId_campaignId: {
            userId: guestUserId,
            campaignId,
          },
        },
      });

      if (!guestShortlist) {
        throw new Error('Guest creator is not shortlisted for this campaign.');
      }

      console.log(`[SWAP] Found guest shortlist:`, guestShortlist);

      // Store guest data to transfer
      const transferData = {
        ugcVideos: guestShortlist.ugcVideos,
        amount: guestShortlist.amount,
        currency: guestShortlist.currency,
        adminComments: guestShortlist.adminComments,
        isAgreementReady: guestShortlist.isAgreementReady,
        isCampaignDone: guestShortlist.isCampaignDone,
        isCreatorPaid: guestShortlist.isCreatorPaid,
        shortlisted_date: guestShortlist.shortlisted_date,
      };

      // Transfer guest creator's profileLink to platform creator
      if (guestUser.creator?.profileLink && platformUser.creator) {
        await tx.creator.update({
          where: { id: platformUser.creator.id },
          data: {
            profileLink: guestUser.creator.profileLink,
          },
        });
        console.log(`[SWAP] Transferred guest profile link to platform creator: ${guestUser.creator.profileLink}`);
      }

      // 2. Delete old shortlist entry for guest
      await tx.shortListedCreator.delete({
        where: {
          userId_campaignId: {
            userId: guestUserId,
            campaignId,
          },
        },
      });
      console.log(`[SWAP] Deleted guest shortlist entry`);

      // 3. Create new shortlist entry for platform creator with transferred data
      await tx.shortListedCreator.create({
        data: {
          userId: platformUserId,
          campaignId,
          ...transferData,
        },
      });
      console.log(`[SWAP] Created platform creator shortlist entry`);

      // 4. Update or create pitch for platform creator
      const guestPitch = await tx.pitch.findFirst({
        where: {
          userId: guestUserId,
          campaignId,
        },
      });

      if (guestPitch) {
        console.log(`[SWAP] Found guest pitch:`, guestPitch.id);

        // Check if platform creator already has a pitch for this campaign
        const existingPlatformPitch = await tx.pitch.findFirst({
          where: {
            userId: platformUserId,
            campaignId,
          },
        });

        if (existingPlatformPitch) {
          // Update existing platform pitch with guest pitch data
          await tx.pitch.update({
            where: { id: existingPlatformPitch.id },
            data: {
              status: guestPitch.status,
              adminComments: guestPitch.adminComments,
              adminCommentedBy: guestPitch.adminCommentedBy,
              amount: guestPitch.amount,
              ugcCredits: guestPitch.ugcCredits,
              agreementTemplateId: guestPitch.agreementTemplateId,
              followerCount: guestPitch.followerCount,
              engagementRate: guestPitch.engagementRate,
            },
          });
          console.log(`[SWAP] Updated existing platform pitch with guest data`);
        } else {
          // Create new pitch for platform creator
          await tx.pitch.create({
            data: {
              userId: platformUserId,
              campaignId,
              type: guestPitch.type,
              status: guestPitch.status,
              content: `Platform creator ${platformUser.name} has been assigned to replace guest creator.`,
              adminComments: guestPitch.adminComments,
              adminCommentedBy: guestPitch.adminCommentedBy,
              amount: guestPitch.amount,
              ugcCredits: guestPitch.ugcCredits,
              agreementTemplateId: guestPitch.agreementTemplateId,
              followerCount: guestPitch.followerCount,
              engagementRate: guestPitch.engagementRate,
            },
          });
          console.log(`[SWAP] Created new platform pitch with guest data`);
        }

        // Delete guest pitch
        await tx.pitch.delete({
          where: { id: guestPitch.id },
        });
        console.log(`[SWAP] Deleted guest pitch`);
      }

      // 5. Update Submissions (if any)
      const submissionUpdates = await tx.submission.updateMany({
        where: {
          userId: guestUserId,
          campaignId,
        },
        data: {
          userId: platformUserId,
        },
      });
      console.log(`[SWAP] Updated ${submissionUpdates.count} submission(s)`);

      // 5.1 Ensure platform creator has AGREEMENT_FORM submission
      // Check if we need to create one (only if guest didn't have one that got transferred)
      const existingAgreementSubmission = await tx.submission.findFirst({
        where: {
          userId: platformUserId,
          campaignId,
          submissionType: {
            type: 'AGREEMENT_FORM',
          },
        },
      });

      if (!existingAgreementSubmission) {
        console.log(`[SWAP] No AGREEMENT_FORM submission found after transfer, creating one for platform creator`);

        // Get the AGREEMENT_FORM timeline from campaign
        const agreementTimeline = await tx.campaignTimeline.findFirst({
          where: {
            campaignId,
            for: 'creator',
            submissionType: {
              type: 'AGREEMENT_FORM',
            },
          },
          include: {
            submissionType: true,
          },
        });

        if (agreementTimeline) {
          // Get the platform creator's board to create task
          const platformCreatorBoard = await tx.board.findUnique({
            where: { userId: platformUserId },
            include: { columns: true },
          });

          const inProgressColumn = platformCreatorBoard?.columns.find((c) => c.name.includes('In Progress'));

          // Create the agreement submission (without complex dependencies for now)
          await tx.submission.create({
            data: {
              campaignId,
              userId: platformUserId,
              submissionTypeId: agreementTimeline.submissionTypeId as string,
              dueDate: agreementTimeline.endDate,
              status: 'IN_PROGRESS',
              ...(inProgressColumn && {
                task: {
                  create: {
                    name: agreementTimeline.name,
                    position: 0,
                    columnId: inProgressColumn.id,
                    priority: '',
                    status: 'In Progress',
                  },
                },
              }),
            },
          });

          console.log(`[SWAP] ✅ Created AGREEMENT_FORM submission for platform creator`);
        } else {
          console.log(`[SWAP] ⚠️ No AGREEMENT_FORM timeline found in campaign`);
        }
      } else {
        console.log(`[SWAP] ✅ Platform creator already has AGREEMENT_FORM submission (transferred from guest)`);
      }

      // 6. Update CreatorAgreements (if any)
      const agreementUpdates = await tx.creatorAgreement.updateMany({
        where: {
          userId: guestUserId,
          campaignId,
        },
        data: {
          userId: platformUserId,
        },
      });
      console.log(`[SWAP] Updated ${agreementUpdates.count} creator agreement(s)`);

      // 7. Update Logistics (if any)
      const logisticUpdates = await tx.logistic.updateMany({
        where: {
          creatorId: guestUserId,
          campaignId,
        },
        data: {
          creatorId: platformUserId,
        },
      });
      console.log(`[SWAP] Updated ${logisticUpdates.count} logistic record(s)`);

      // 8. Update Tasks (if any)
      const taskUpdates = await tx.task.updateMany({
        where: {
          submission: {
            userId: guestUserId,
            campaignId,
          },
        },
        data: {
          // Tasks are linked through submission, already updated
        },
      });

      // 9. Update UserThread (campaign thread) - Remove guest, ensure platform creator is added
      const campaignThread = await tx.thread.findUnique({
        where: { campaignId },
      });

      if (campaignThread) {
        // Delete guest from thread
        await tx.userThread.deleteMany({
          where: {
            userId: guestUserId,
            threadId: campaignThread.id,
          },
        });
        console.log(`[SWAP] Removed guest from thread`);

        // Add platform creator to thread (if not already)
        const existingUserThread = await tx.userThread.findUnique({
          where: {
            userId_threadId: {
              userId: platformUserId,
              threadId: campaignThread.id,
            },
          },
        });

        if (!existingUserThread) {
          await tx.userThread.create({
            data: {
              userId: platformUserId,
              threadId: campaignThread.id,
            },
          });
          console.log(`[SWAP] Added platform creator to thread`);
        }
      }

      // 10. Check if guest user has any other relationships
      const otherShortlists = await tx.shortListedCreator.count({
        where: { userId: guestUserId },
      });

      const otherPitches = await tx.pitch.count({
        where: { userId: guestUserId },
      });

      const otherSubmissions = await tx.submission.count({
        where: { userId: guestUserId },
      });

      console.log(
        `[SWAP] Guest user other relationships: ${otherShortlists} shortlists, ${otherPitches} pitches, ${otherSubmissions} submissions`,
      );

      // 11. If guest user has no other relationships, delete guest user and creator
      if (otherShortlists === 0 && otherPitches === 0 && otherSubmissions === 0) {
        console.log(`[SWAP] Guest user has no other relationships, deleting...`);

        // Delete guest user's notifications first (foreign key constraint)
        const deletedNotifications = await tx.userNotification.deleteMany({
          where: { userId: guestUserId },
        });
        console.log(`[SWAP] Deleted ${deletedNotifications.count} notification(s)`);

        // Delete guest creator (foreign key constraint)
        await tx.creator.delete({
          where: { userId: guestUserId },
        });
        console.log(`[SWAP] Deleted guest creator record`);

        // Delete guest user
        await tx.user.delete({
          where: { id: guestUserId },
        });
        console.log(`[SWAP] Deleted guest user record`);
      } else {
        console.log(`[SWAP] Guest user has other relationships, keeping user record`);
      }

      return {
        guestUserId,
        platformUserId,
        transferredData: transferData,
        guestDeleted: otherShortlists === 0 && otherPitches === 0 && otherSubmissions === 0,
      };
    });

    // Log admin activity
    const adminLogMessage = `Swapped guest creator ${guestUser.name} with platform creator ${platformUser.name} for campaign "${campaign.name}"`;
    logAdminChange(adminLogMessage, adminId, req);

    return res.status(200).json({
      message: 'Successfully swapped guest creator with platform creator.',
      result,
    });
  } catch (error) {
    console.error('[SWAP] Error swapping creators:', error);
    return res.status(400).json({
      message: error instanceof Error ? error.message : 'Failed to swap creators',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Clean up orphaned guest users
 *
 * Finds and deletes guest users that have no active relationships
 *
 * POST /api/campaign/cleanupGuestCreators
 */
export const cleanupOrphanedGuestUsers = async (req: Request, res: Response) => {
  const adminId = req.session.userid;

  try {
    // Find all guest users
    const guestUsers = await prisma.user.findMany({
      where: {
        status: 'guest',
        creator: {
          isGuest: true,
        },
      },
      include: {
        creator: true,
        shortlisted: true,
        pitch: true,
        submission: true,
      },
    });

    console.log(`[CLEANUP] Found ${guestUsers.length} guest users`);

    const orphanedGuests = guestUsers.filter(
      (user) => user.shortlisted.length === 0 && user.pitch.length === 0 && user.submission.length === 0,
    );

    console.log(`[CLEANUP] Found ${orphanedGuests.length} orphaned guest users`);

    if (orphanedGuests.length === 0) {
      return res.status(200).json({
        message: 'No orphaned guest users found.',
        deleted: 0,
      });
    }

    // Delete orphaned guests
    const deleted = await prisma.$transaction(async (tx) => {
      let count = 0;

      for (const guest of orphanedGuests) {
        try {
          // Delete user notifications first (foreign key constraint)
          await tx.userNotification.deleteMany({
            where: { userId: guest.id },
          });

          // Delete creator
          await tx.creator.delete({
            where: { userId: guest.id },
          });

          // Delete user
          await tx.user.delete({
            where: { id: guest.id },
          });

          count++;
          console.log(`[CLEANUP] Deleted orphaned guest: ${guest.name} (${guest.id})`);
        } catch (error) {
          console.error(`[CLEANUP] Failed to delete guest ${guest.id}:`, error);
        }
      }

      return count;
    });

    // Log admin activity
    const adminLogMessage = `Cleaned up ${deleted} orphaned guest creator(s)`;
    logAdminChange(adminLogMessage, adminId, req);

    return res.status(200).json({
      message: `Successfully cleaned up ${deleted} orphaned guest users.`,
      deleted,
    });
  } catch (error) {
    console.error('[CLEANUP] Error cleaning up orphaned guests:', error);
    return res.status(500).json({
      message: 'Failed to cleanup orphaned guest users',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Get list of guest creators for a campaign
 *
 * Returns all guest creators shortlisted for a specific campaign
 *
 * GET /api/campaign/:campaignId/guestCreators
 */
export const getGuestCreatorsForCampaign = async (req: Request, res: Response) => {
  const { campaignId } = req.params;

  try {
    const guestCreators = await prisma.shortListedCreator.findMany({
      where: {
        campaignId,
        user: {
          status: 'guest',
          creator: {
            isGuest: true,
          },
        },
      },
      include: {
        user: {
          include: {
            creator: true,
          },
        },
      },
    });

    return res.status(200).json({
      guestCreators: guestCreators.map((sc) => ({
        id: sc.id,
        userId: sc.userId,
        name: sc.user?.name,
        email: sc.user?.email,
        ugcVideos: sc.ugcVideos,
        amount: sc.amount,
        currency: sc.currency,
        adminComments: sc.adminComments,
        shortlisted_date: sc.shortlisted_date,
      })),
    });
  } catch (error) {
    console.error('[GET_GUESTS] Error fetching guest creators:', error);
    return res.status(500).json({
      message: 'Failed to fetch guest creators',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

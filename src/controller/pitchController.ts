import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import dayjs from 'dayjs';
import { clients, io } from '../server';
import { saveNotification } from './notificationController';
import { notificationPitchForClientReview } from '@helper/notification';

const prisma = new PrismaClient();

// Utility function to map submission types to entities
const getEntityFromSubmissionType = (submissionType: string, userRole?: 'admin' | 'client' | 'creator') => {
  const baseEntity = (() => {
    switch (submissionType) {
      case 'AGREEMENT_FORM':
        return 'AgreementForm';
      case 'FIRST_DRAFT':
        return 'FirstDraft';
      case 'FINAL_DRAFT':
        return 'FinalDraft';
      case 'POSTING':
        return 'Posting';
      default:
        return 'Draft';
    }
  })();

  // If user role is specified, use role-specific entities
  if (userRole) {
    switch (userRole) {
      case 'admin':
        return `Admin${baseEntity}`;
      case 'client':
        return `Client${baseEntity}`;
      default:
        return baseEntity; // For creators, use generic entities
    }
  }

  return baseEntity; // Fallback to generic entities
};

const normalizePitchStatusForV4 = (pitch: any): string | null => {
  const originalStatus: string | null = pitch?.status ?? null;
  const submissionVersion: string | undefined = pitch?.campaign?.submissionVersion;

  if (!originalStatus || submissionVersion !== 'v4') {
    return originalStatus;
  }

  const legacyStatusMap: Record<string, string> = {
    undecided: 'PENDING_REVIEW',
    pending: 'PENDING_REVIEW',
    approved: 'APPROVED',
    rejected: 'REJECTED',
    filtered: 'REJECTED',
    draft: 'DRAFT',
  };

  return legacyStatusMap[originalStatus] || originalStatus;
};

export const approvePitchByAdmin = async (req: Request, res: Response) => {
  const { pitchId } = req.params;
  const { adminComments } = req.body;
  const adminId = req.session.userid;

  try {
    console.log(
      `Admin ${adminId} approving pitch ${pitchId} with comments: ${adminComments}`,
    );

    const pitch = await prisma.pitch.findUnique({
      where: { id: pitchId },
      include: {
        campaign: {
          include: {
            campaignAdmin: {
              include: {
                admin: {
                  include: {
                    user: true,
                  },
                },
              },
            },
            shortlisted: true,
          },
        },
        user: true,
      },
    });

    if (!pitch) {
      return res.status(404).json({ message: 'Pitch not found' });
    }

    // Check if pitch is in correct status - allow admin to approve from PENDING_REVIEW or MAYBE
    if (pitch.status !== 'PENDING_REVIEW' && pitch.status !== 'MAYBE') {
      return res.status(400).json({ message: 'Pitch is not in correct status for admin approval' });
    }

    const isV4Campaign = pitch.campaign.submissionVersion === 'v4';

    // Determine status based on campaign type:
    // - v4 campaigns: SENT_TO_CLIENT (client needs to approve)
    // - non-v4 campaigns: APPROVED directly (admin approval is final)
    const newStatus = isV4Campaign ? 'SENT_TO_CLIENT' : 'APPROVED';

    const updateData: {
      status: 'SENT_TO_CLIENT' | 'APPROVED';
      approvedByAdminId: string;
      adminComments?: string;
      adminCommentedBy?: string;
    } = {
      status: newStatus,
      approvedByAdminId: adminId,
    };

    if (adminComments && typeof adminComments === 'string' && adminComments.trim().length > 0) {
      updateData.adminComments = adminComments.trim();
      updateData.adminCommentedBy = adminId;
    }

    // Update pitch status
    const updatedPitch = await prisma.pitch.update({
      where: { id: pitchId },
      data: updateData,
      include: {
        campaign: true,
        user: true,
        admin: {
          include: {
            user: true,
          },
        },
      },
    });

    // For non-v4 campaigns: Handle full approval flow (shortlist, credits, submissions)
    if (!isV4Campaign) {
      // Create or update ShortListedCreator
      const existingShortlist = await prisma.shortListedCreator.findUnique({
        where: {
          userId_campaignId: {
            userId: pitch.userId,
            campaignId: pitch.campaignId,
          },
        },
      });

      if (existingShortlist) {
        await prisma.shortListedCreator.update({
          where: {
            userId_campaignId: {
              userId: pitch.userId,
              campaignId: pitch.campaignId,
            },
          },
          data: {
            isAgreementReady: false,
          },
        });
      } else {
        await prisma.shortListedCreator.create({
          data: {
            userId: pitch.userId,
            campaignId: pitch.campaignId,
            isAgreementReady: false,
            currency: 'MYR',
          },
        });
      }

      // Create creatorAgreement for non-v4 campaigns (if it doesn't exist)
      const existingAgreement = await prisma.creatorAgreement.findFirst({
        where: {
          userId: pitch.userId,
          campaignId: pitch.campaignId,
        },
      });

      if (!existingAgreement) {
        console.log(`Creating creatorAgreement for non-v4 pitch approval - ${pitch.userId}`);
        await prisma.creatorAgreement.create({
          data: {
            userId: pitch.userId,
            campaignId: pitch.campaignId,
            agreementUrl: '',
          },
        });
      }

      // Note: Credits are now only utilized when agreement is sent (in sendAgreement function)
      // ugcVideos is still assigned to shortlistedCreator for submission creation

      // Create submission records for non-v4 approved pitches
      const timelines = await prisma.campaignTimeline.findMany({
        where: {
          campaignId: pitch.campaignId,
          for: 'creator',
          name: { not: 'Open For Pitch' },
        },
        include: { submissionType: true },
        orderBy: { order: 'asc' },
      });

      // Get creator's board
      const board = await prisma.board.findUnique({
        where: { userId: pitch.userId },
        include: { columns: true },
      });

      if (board) {
        const columnToDo = board.columns.find((c) => c.name.includes('To Do'));
        const columnInProgress = board.columns.find((c) => c.name.includes('In Progress'));

        if (columnToDo && columnInProgress) {
          console.log(`Creating submissions for non-v4 campaign - ${timelines.length} timeline(s)`);

          // Create submissions for timeline items
          const submissions = await Promise.all(
            timelines.map(async (timeline, index) => {
              return await prisma.submission.create({
                data: {
                  dueDate: timeline.endDate,
                  campaignId: timeline.campaignId,
                  userId: pitch.userId,
                  status: timeline.submissionType?.type === 'AGREEMENT_FORM' ? 'IN_PROGRESS' : 'NOT_STARTED',
                  submissionTypeId: timeline.submissionTypeId as string,
                  task: {
                    create: {
                      name: timeline.name,
                      position: index,
                      columnId: timeline.submissionType?.type ? columnInProgress.id : columnToDo.id,
                      priority: '',
                      status: timeline.submissionType?.type ? 'In Progress' : 'To Do',
                    },
                  },
                },
                include: {
                  submissionType: true,
                },
              });
            }),
          );

          // Create dependencies between submissions for non-v4 campaigns
          const agreement = submissions.find((s) => s.submissionType?.type === 'AGREEMENT_FORM');
          const draft = submissions.find((s) => s.submissionType?.type === 'FIRST_DRAFT');
          const finalDraft = submissions.find((s) => s.submissionType?.type === 'FINAL_DRAFT');
          const posting = submissions.find((s) => s.submissionType?.type === 'POSTING');

          const dependencies = [
            { submissionId: draft?.id, dependentSubmissionId: agreement?.id },
            { submissionId: finalDraft?.id, dependentSubmissionId: draft?.id },
            { submissionId: posting?.id, dependentSubmissionId: finalDraft?.id },
          ].filter((dep) => dep.submissionId && dep.dependentSubmissionId);

          if (dependencies.length > 0) {
            await prisma.submissionDependency.createMany({ data: dependencies });
          }

          console.log(`Created ${submissions.length} submissions for non-v4 admin pitch approval`);
        }
      }
    }

    if (isV4Campaign) {
      // V4 flow: Notify client users for review
      const clientUsers = pitch.campaign.campaignAdmin.filter((ca) => ca.admin.user.role === 'client');

      for (const clientUser of clientUsers) {
        const { title, message } = notificationPitchForClientReview(pitch.campaign.name);

        const notification = await saveNotification({
          userId: clientUser.admin.userId,
          title: title,
          message: message,
          entity: 'Pitch',
          entityId: pitch.campaignId,
        });

        const clientSocketId = clients.get(clientUser.admin.userId);
        if (clientSocketId) {
          io.to(clientSocketId).emit('notification', notification);
        }
      }

      // Log campaign activity for admin pitch approval (v4 - sent to client)
      await prisma.campaignLog.create({
        data: {
          message: `${pitch.user.name || 'Creator'}'s pitch has been approved`,
          adminId: adminId,
          campaignId: pitch.campaignId,
        },
      });

      console.log(
        `Pitch ${pitchId} approved by admin, status updated to SENT_TO_CLIENT (v4 flow)`,
      );
      console.log(adminComments ? `Comments: ${adminComments}` : 'No comments provided');
      return res.status(200).json({
        message: 'Pitch approved and sent to client for review',
        pitch: updatedPitch,
      });
    } else {
      // Non-v4 flow: Admin approval is final, notify creator
      const creatorNotification = await saveNotification({
        userId: pitch.userId,
        title: 'Pitch Approved! 🎉',
        message: `Your pitch for campaign "${pitch.campaign.name}" has been approved. Check your agreements to get started.`,
        entity: 'Pitch',
        entityId: pitch.campaignId,
      });

      const creatorSocketId = clients.get(pitch.userId);
      if (creatorSocketId) {
        io.to(creatorSocketId).emit('notification', creatorNotification);
        io.to(creatorSocketId).emit('pitchUpdate');
      }

      // Log campaign activity for admin pitch approval
      await prisma.campaignLog.create({
        data: {
          message: `${pitch.user.name || 'Creator'}'s pitch has been approved`,
          adminId: adminId,
          campaignId: pitch.campaignId,
        },
      });

      console.log(
        `Pitch ${pitchId} approved by admin, status updated to APPROVED (non-v4 direct approval)`,
      );
      console.log(adminComments ? `Comments: ${adminComments}` : 'No comments provided');
      return res.status(200).json({
        message: 'Pitch approved successfully',
        pitch: updatedPitch,
      });
    }
  } catch (error) {
    console.error('Error approving pitch by admin:', error);
    return res.status(500).json({ message: 'Failed to approve pitch' });
  }
};

// New Flow: Admin rejects pitch
export const rejectPitchByAdmin = async (req: Request, res: Response) => {
  const { pitchId } = req.params;
  const { rejectionReason } = req.body;
  const adminId = req.session.userid;

  try {
    console.log(`Admin ${adminId} rejecting pitch ${pitchId}`);

    const pitch = await prisma.pitch.findUnique({
      where: { id: pitchId },
      include: {
        campaign: true,
        user: true,
      },
    });

    if (!pitch) {
      return res.status(404).json({ message: 'Pitch not found' });
    }

    // Check if pitch is in correct status - allow admin to reject from PENDING_REVIEW or MAYBE
    if (pitch.status !== 'PENDING_REVIEW' && pitch.status !== 'MAYBE') {
      return res.status(400).json({ message: 'Pitch is not in correct status for admin rejection' });
    }

    // Update pitch status to rejected
    await prisma.pitch.update({
      where: { id: pitchId },
      data: {
        status: 'REJECTED',
        rejectedByAdminId: adminId,
        rejectionReason: rejectionReason || 'Rejected by admin',
      },
    });

    // Remove creator from campaign
    await prisma.shortListedCreator.deleteMany({
      where: {
        userId: pitch.userId,
        campaignId: pitch.campaignId,
      },
    });

    // Create notification for creator
    // await prisma.notification.create({
    //   data: {
    //     title: 'Pitch Rejected',
    //     message: `Your pitch for campaign "${pitch.campaign.name}" has been rejected by admin.`,
    //     entity: 'Pitch',
    //     campaignId: pitch.campaignId,
    //     pitchId: pitchId,
    //     userId: pitch.userId,
    //   },
    // });
    const notification = await saveNotification({
      userId: pitch.userId,
      title: 'Pitch Rejected',
      message: `Your pitch for campaign "${pitch.campaign.name}" has been rejected by admin.`,
      entity: 'Pitch',
      entityId: pitch.campaignId,
    });

    const socketId = clients.get(pitch.userId);
    if (socketId) {
      io.to(socketId).emit('notification', notification);
      io.to(socketId).emit('pitchUpdate');
    }

    // Fetch the updated pitch to return in response
    const updatedPitch = await prisma.pitch.findUnique({
      where: { id: pitchId },
      include: {
        campaign: true,
        user: true,
      },
    });

    // Create campaign log for admin rejection
    await prisma.campaignLog.create({
      data: {
        message: `${pitch.user.name || 'Creator'}'s pitch has been rejected`,
        adminId: adminId,
        campaignId: pitch.campaignId,
      },
    });

    console.log(`Pitch ${pitchId} rejected by admin, creator removed from campaign`);
    return res.status(200).json({
      message: 'Pitch rejected and creator removed from campaign',
      pitch: updatedPitch,
    });
  } catch (error) {
    console.error('Error rejecting pitch by admin:', error);
    return res.status(500).json({ message: 'Failed to reject pitch' });
  }
};

// New Flow: Client approves pitch
export const approvePitchByClient = async (req: Request, res: Response) => {
  const { pitchId } = req.params;
  const clientId = req.session.userid;

  try {
    console.log(`Client ${clientId} approving pitch ${pitchId}`);

    const pitch = await prisma.pitch.findUnique({
      where: { id: pitchId },
      include: {
        campaign: {
          include: {
            campaignAdmin: {
              include: {
                admin: {
                  include: {
                    user: true,
                  },
                },
              },
            },
          },
        },
        user: true,
      },
    });

    if (!pitch) {
      return res.status(404).json({ message: 'Pitch not found' });
    }

    console.log(
      `Client approval attempt - Pitch ID: ${pitchId}, Current status: ${pitch.status}, Client ID: ${clientId}`,
    );

    // Check if this is a client-created campaign OR admin-created v4 campaign
    if (pitch.campaign.origin !== 'CLIENT' && pitch.campaign.submissionVersion !== 'v4') {
      return res.status(400).json({ message: 'This endpoint is only for client-created campaigns or v4 campaigns' });
    }

    // Check if pitch was already approved by this client
    if (pitch.approvedByClientId === clientId) {
      return res.status(400).json({ message: 'Pitch already approved by this client' });
    }

    // Check if pitch is in correct status
    if (pitch.status !== 'SENT_TO_CLIENT') {
      return res.status(400).json({
        message: `Pitch is not in correct status for client approval. Current status: ${pitch.status}, Expected: SENT_TO_CLIENT`,
      });
    }

    // Verify client has access to this campaign
    const clientAccess = pitch.campaign.campaignAdmin.find(
      (ca) => ca.admin.userId === clientId && ca.admin.user.role === 'client',
    );

    if (!clientAccess) {
      return res.status(403).json({ message: 'Client not authorized for this campaign' });
    }

    await prisma.pitch.update({
      where: { id: pitchId },
      data: {
        status: 'APPROVED',
        approvedByClientId: clientId,
      },
    });

    const existingShortlist = await prisma.shortListedCreator.findUnique({
      where: {
        userId_campaignId: {
          userId: pitch.userId,
          campaignId: pitch.campaignId,
        },
      },
    });

    if (existingShortlist) {
      await prisma.shortListedCreator.update({
        where: {
          userId_campaignId: {
            userId: pitch.userId,
            campaignId: pitch.campaignId,
          },
        },
        data: {
          isAgreementReady: false,
        },
      });
    } else {
      await prisma.shortListedCreator.create({
        data: {
          userId: pitch.userId,
          campaignId: pitch.campaignId,
          isAgreementReady: false,
          currency: 'MYR',
        },
      });
    }

    // Create creatorAgreement for v4 campaigns (if it doesn't exist)
    // This ensures the agreement record exists before admin sets amount and sends it
    const existingAgreement = await prisma.creatorAgreement.findFirst({
      where: {
        userId: pitch.userId,
        campaignId: pitch.campaignId,
      },
    });

    if (!existingAgreement) {
      console.log(`Creating creatorAgreement for v4 client approval - ${pitch.userId}`);
      await prisma.creatorAgreement.create({
        data: {
          userId: pitch.userId,
          campaignId: pitch.campaignId,
          agreementUrl: '',
        },
      });
    }

    // Check if submissions already exist for this user/campaign to prevent duplicates
    const existingSubmissions = await prisma.submission.findMany({
      where: {
        userId: pitch.userId,
        campaignId: pitch.campaignId,
      },
      include: { submissionType: true },
    });

    // Create submission records for V3 approved pitches (similar to V2 shortlisting)
    const timelines = await prisma.campaignTimeline.findMany({
      where: {
        campaignId: pitch.campaignId,
        for: 'creator',
        name: { not: 'Open For Pitch' },
      },
      include: { submissionType: true },
      orderBy: { order: 'asc' },
    });

    // Get creator's board
    const board = await prisma.board.findUnique({
      where: { userId: pitch.userId },
      include: { columns: true },
    });

    if (board) {
      const columnToDo = board.columns.find((c) => c.name.includes('To Do'));
      const columnInProgress = board.columns.find((c) => c.name.includes('In Progress'));

      if (columnToDo && columnInProgress) {
        const isV4Campaign = pitch.campaign.submissionVersion === 'v4';
        const v2SubmissionTypes = ['FIRST_DRAFT', 'FINAL_DRAFT', 'POSTING'];

        const timelinesFiltered = isV4Campaign
          ? timelines.filter((t) => !v2SubmissionTypes.includes(t.submissionType?.type || ''))
          : timelines;

        // Get existing submission types for this user/campaign to avoid duplicates
        const existingSubmissionTypes = new Set<string | undefined>(
          existingSubmissions.map((s) => s.submissionType?.type),
        );

        // Filter out timelines that already have submissions
        const timelinesWithoutExisting = timelinesFiltered.filter(
          (t) => t.submissionType?.type && !existingSubmissionTypes.has(t.submissionType.type),
        );

        console.log(
          `Creating submissions for ${isV4Campaign ? 'v4' : 'v2'} campaign - ${timelinesWithoutExisting.length} timeline(s) (${existingSubmissions.length} already exist)`,
        );

        // Only create submissions if there are new ones to create
        if (timelinesWithoutExisting.length > 0) {
          // Create submissions for timeline items
          const submissions = await Promise.all(
            timelinesWithoutExisting.map(async (timeline, index) => {
              return await prisma.submission.create({
                data: {
                  dueDate: timeline.endDate,
                  campaignId: timeline.campaignId,
                  userId: pitch.userId,
                  status: timeline.submissionType?.type === 'AGREEMENT_FORM' ? 'IN_PROGRESS' : 'NOT_STARTED',
                  submissionTypeId: timeline.submissionTypeId as string,
                  submissionVersion: isV4Campaign ? 'v4' : undefined, // Explicitly set v4 for v4 campaigns
                  task: {
                    create: {
                      name: timeline.name,
                      position: index,
                      columnId: timeline.submissionType?.type ? columnInProgress.id : columnToDo.id,
                      priority: '',
                      status: timeline.submissionType?.type ? 'In Progress' : 'To Do',
                    },
                  },
                },
                include: {
                  submissionType: true,
                },
              });
            }),
          );

          // Create dependencies between submissions (only for v2 campaigns)
          if (!isV4Campaign) {
            const agreement = submissions.find((s) => s.submissionType?.type === 'AGREEMENT_FORM');
            const draft = submissions.find((s) => s.submissionType?.type === 'FIRST_DRAFT');
            const finalDraft = submissions.find((s) => s.submissionType?.type === 'FINAL_DRAFT');
            const posting = submissions.find((s) => s.submissionType?.type === 'POSTING');

            const dependencies = [
              { submissionId: draft?.id, dependentSubmissionId: agreement?.id },
              { submissionId: finalDraft?.id, dependentSubmissionId: draft?.id },
              { submissionId: posting?.id, dependentSubmissionId: finalDraft?.id },
            ].filter((dep) => dep.submissionId && dep.dependentSubmissionId);

            if (dependencies.length > 0) {
              await prisma.submissionDependency.createMany({ data: dependencies });
            }
          }

          console.log(`Created ${submissions.length} submissions for V3 pitch approval`);
        } else {
          console.log(
            `No new submissions to create - ${existingSubmissions.length} already exist for this user/campaign`,
          );
        }
      }
    }

    if (pitch.campaign.submissionVersion !== 'v4') {
      console.log(
        `ℹ️  Campaign ${pitch.campaignId} is not V4 (version: ${pitch.campaign.submissionVersion}) - skipping V4 content submission creation`,
      );
    }

    // Find admin users for this campaign
    const adminUsers = pitch.campaign.campaignAdmin.filter(
      (ca) => ca.admin.user.role === 'admin' || ca.admin.user.role === 'superadmin', // should superadmin get this notif?
    );

    for (const adminUser of adminUsers) {
      // use saveNotification helper to store notifications
      const notification = await saveNotification({
        title: `📝 Agreements needed`,
        message: `Finalise your shortlisted creators to keep ${pitch.campaign.name} moving.`,
        entity: 'Creator',
        entityId: pitch.campaign.id,
        pitchId: pitchId,
        userId: adminUser.admin.userId,
      });

      const adminSocketId = clients.get(adminUser.admin.userId);

      if (adminSocketId) {
        io.to(adminSocketId).emit('notification', notification);
      }
    }

    // Create campaign log for client approval
    // Log campaign activity for client pitch approval
    await prisma.campaignLog.create({
      data: {
        message: `${pitch.user.name || 'Creator'}'s profile has been approved`,
        adminId: clientId,
        campaignId: pitch.campaignId,
      },
    });

    console.log(`Pitch ${pitchId} approved by client, status updated to APPROVED`);
    return res.status(200).json({ message: 'Pitch approved by client' });
  } catch (error) {
    console.error('Error approving pitch by client:', error);
    return res.status(500).json({ message: 'Failed to approve pitch' });
  }
};

// V3 Flow: Client rejects pitch for client-created campaign
export const rejectPitchByClient = async (req: Request, res: Response) => {
  const { pitchId } = req.params;
  const { rejectionReason, customRejectionText } = req.body;
  const clientId = req.session.userid;

  try {
    console.log(`Client ${clientId} rejecting pitch ${pitchId}`);

    const pitch = await prisma.pitch.findUnique({
      where: { id: pitchId },
      include: {
        campaign: {
          include: {
            campaignAdmin: {
              include: {
                admin: {
                  include: {
                    user: true,
                  },
                },
              },
            },
          },
        },
        user: true,
      },
    });

    if (!pitch) {
      return res.status(404).json({ message: 'Pitch not found' });
    }

    // Check if this is a client-created campaign OR admin-created v4 campaign
    if (pitch.campaign.origin !== 'CLIENT' && pitch.campaign.submissionVersion !== 'v4') {
      return res.status(400).json({ message: 'This endpoint is only for client-created campaigns or v4 campaigns' });
    }

    // Check if pitch is in correct status
    if (pitch.status !== 'SENT_TO_CLIENT') {
      return res.status(400).json({ message: 'Pitch is not in correct status for client rejection' });
    }

    // Verify client has access to this campaign
    const clientAccess = pitch.campaign.campaignAdmin.find(
      (ca) => ca.admin.userId === clientId && ca.admin.user.role === 'client',
    );

    if (!clientAccess) {
      return res.status(403).json({ message: 'Client not authorized for this campaign' });
    }

    // Update pitch status to rejected
    await prisma.pitch.update({
      where: { id: pitchId },
      data: {
        status: 'REJECTED',
        rejectedByClientId: clientId,
        rejectionReason: rejectionReason || 'Rejected by client',
        customRejectionText: customRejectionText,
      },
    });

    // Remove creator from campaign
    await prisma.shortListedCreator.deleteMany({
      where: {
        userId: pitch.userId,
        campaignId: pitch.campaignId,
      },
    });

    // Create notification for creator
    const creatorNotification = await saveNotification({
      title: 'Pitch Rejected',
      message: `Your pitch for campaign "${pitch.campaign.name}" has been rejected by client.`,
      entity: 'Pitch',
      campaignId: pitch.campaignId,
      pitchId: pitchId,
      userId: pitch.userId,
    });

    const creatorSocketId = clients.get(pitch.userId);

    if (creatorSocketId) {
      io.to(creatorSocketId).emit('notification', creatorNotification);
    }

    // Create notification for admin
    const adminUsers = pitch.campaign.campaignAdmin.filter(
      (ca) => ca.admin.user.role === 'admin' || ca.admin.user.role === 'superadmin',
    );

    for (const adminUser of adminUsers) {
      const adminNotification = await saveNotification({
        title: 'Pitch Rejected by Client',
        message: `A pitch for campaign "${pitch.campaign.name}" has been rejected by client.`,
        entity: 'Pitch',
        campaignId: pitch.campaignId,
        pitchId: pitchId,
        userId: adminUser.admin.userId,
      });

      const adminSocketId = clients.get(adminUser.admin.userId);

      if (adminSocketId) {
        io.to(adminSocketId).emit('notification', adminNotification);
      }
    }

    // Create campaign log for client rejection
    // Log campaign activity for client pitch rejection
    await prisma.campaignLog.create({
      data: {
        message: `${pitch.user.name || 'Creator'}'s profile has been rejected`,
        adminId: clientId,
        campaignId: pitch.campaignId,
      },
    });

    console.log(`Pitch ${pitchId} rejected by client, creator removed from campaign`);
    return res.status(200).json({ message: 'Pitch rejected and creator removed from campaign' });
  } catch (error) {
    console.error('Error rejecting pitch by client:', error);
    return res.status(500).json({ message: 'Failed to reject pitch' });
  }
};

// Withdraw an approved creator from the campaign
export const withdrawCreatorFromCampaign = async (req: Request, res: Response) => {
  const { pitchId } = req.params;
  const { reason } = req.body;
  const adminId = req.session.userid;

  try {
    console.log(`Admin ${adminId} withdrawing creator from pitch ${pitchId}`);

    const pitch = await prisma.pitch.findUnique({
      where: { id: pitchId },
      include: {
        campaign: true,
        user: true,
      },
    });

    if (!pitch) {
      return res.status(404).json({ message: 'Pitch not found' });
    }

    // Only allow withdrawal for approved pitches (APPROVED, AGREEMENT_PENDING, AGREEMENT_SUBMITTED)
    const withdrawableStatuses = ['APPROVED', 'AGREEMENT_PENDING', 'AGREEMENT_SUBMITTED', 'approved'];
    if (!withdrawableStatuses.includes(pitch.status || '')) {
      return res.status(400).json({
        message: 'Creator can only be withdrawn after being approved. Use reject for non-approved pitches.',
      });
    }

    // Update pitch status to WITHDRAWN
    const updatedPitch = await prisma.pitch.update({
      where: { id: pitchId },
      data: {
        status: 'WITHDRAWN',
        rejectionReason: reason || 'Withdrawn by admin',
        rejectedByAdminId: adminId,
      },
      include: {
        campaign: true,
        user: true,
      },
    });

    // Delete any existing creator agreement for this campaign
    await prisma.creatorAgreement.deleteMany({
      where: {
        userId: pitch.userId,
        campaignId: pitch.campaignId,
      },
    });

    // Delete any submissions for this creator in this campaign
    await prisma.submission.deleteMany({
      where: {
        userId: pitch.userId,
        campaignId: pitch.campaignId,
      },
    });

    await prisma.logistic.deleteMany({
      where: {
        creatorId: pitch.userId,
        campaignId: pitch.campaignId,
      },
    });

    // Create notification for creator
    const notification = await saveNotification({
      userId: pitch.userId,
      title: 'Withdrawn from Campaign',
      message: `You have been withdrawn from campaign "${pitch.campaign.name}".`,
      entity: 'Pitch',
      entityId: pitch.campaignId,
    });

    const socketId = clients.get(pitch.userId);
    if (socketId) {
      io.to(socketId).emit('notification', notification);
      io.to(socketId).emit('pitchUpdate');
    }

    // Create campaign log
    // Log campaign activity for admin withdrawal
    await prisma.campaignLog.create({
      data: {
        message: `${pitch.user.name || 'Creator'} has been withdrawn from the campaign`,
        adminId: adminId,
        campaignId: pitch.campaignId,
      },
    });

    console.log(`Creator ${pitch.userId} withdrawn from campaign ${pitch.campaignId}`);
    return res.status(200).json({
      message: 'Creator successfully withdrawn from campaign',
      pitch: updatedPitch,
    });
  } catch (error) {
    console.error('Error withdrawing creator from campaign:', error);
    return res.status(500).json({ message: 'Failed to withdraw creator from campaign' });
  }
};

// V3.1 Flow: Client maybe option
export const maybePitchByClient = async (req: Request, res: Response) => {
  const { pitchId } = req.params;
  const { rejectionReason, customRejectionText } = req.body;
  const clientId = req.session.userid;

  try {
    console.log(`Client ${clientId} setting pitch ${pitchId} to maybe`);

    const pitch = await prisma.pitch.findUnique({
      where: { id: pitchId },
      include: {
        campaign: {
          include: {
            campaignAdmin: {
              include: {
                admin: {
                  include: {
                    user: true,
                  },
                },
              },
            },
          },
        },
        user: true,
      },
    });

    if (!pitch) {
      return res.status(404).json({ message: 'Pitch not found' });
    }

    // Check if this is a client-created campaign OR admin-created v4 campaign
    if (pitch.campaign.origin !== 'CLIENT' && pitch.campaign.submissionVersion !== 'v4') {
      return res.status(400).json({ message: 'This endpoint is only for client-created campaigns or v4 campaigns' });
    }

    // Check if pitch is in correct status
    if (pitch.status !== 'SENT_TO_CLIENT') {
      return res.status(400).json({ message: 'Pitch is not in correct status for client action' });
    }

    // Verify client has access to this campaign
    const clientAccess = pitch.campaign.campaignAdmin.find(
      (ca) => ca.admin.userId === clientId && ca.admin.user.role === 'client',
    );

    if (!clientAccess) {
      return res.status(403).json({ message: 'Client not authorized for this campaign' });
    }

    await prisma.pitch.update({
      where: { id: pitchId },
      data: {
        status: 'MAYBE',
        maybeByClientId: clientId,
        rejectionReason: rejectionReason,
        customRejectionText: customRejectionText,
      },
    });

    // Create notification for creator
    await prisma.notification.create({
      data: {
        title: 'Pitch Under Consideration',
        message: `Your pitch for campaign "${pitch.campaign.name}" is under consideration by the client.`,
        entity: 'Pitch',
        campaignId: pitch.campaignId,
        pitchId: pitchId,
        userId: pitch.userId,
      },
    });

    // Create notification for admin
    const adminUsers = pitch.campaign.campaignAdmin.filter(
      (ca) => ca.admin.user.role === 'admin' || ca.admin.user.role === 'superadmin',
    );

    for (const adminUser of adminUsers) {
      await prisma.notification.create({
        data: {
          title: 'Pitch Set to Maybe by Client',
          message: `A pitch for campaign "${pitch.campaign.name}" has been set to maybe by client.`,
          entity: 'Pitch',
          campaignId: pitch.campaignId,
          pitchId: pitchId,
          userId: adminUser.admin.userId,
        },
      });
    }

    // Create campaign log for client maybe
    // Log campaign activity for client setting pitch to maybe
    await prisma.campaignLog.create({
      data: {
        message: `Chose maybe for ${pitch.user.name || 'Creator'}`,
        adminId: clientId,
        campaignId: pitch.campaignId,
      },
    });

    console.log(`Pitch ${pitchId} set to maybe by client`);
    return res.status(200).json({ message: 'Pitch status updated to maybe' });
  } catch (error) {
    console.error('Error setting pitch to maybe by client:', error);
    return res.status(500).json({ message: 'Failed to update pitch status' });
  }
};

// V3 Flow: Admin sets agreement details
export const setPitchAgreement = async (req: Request, res: Response) => {
  const { pitchId } = req.params;
  const { amount, agreementTemplateId } = req.body;
  const adminId = req.session.userid;

  try {
    console.log(`Admin ${adminId} setting agreement for pitch ${pitchId}`);

    const pitch = await prisma.pitch.findUnique({
      where: { id: pitchId },
      include: {
        campaign: true,
        user: true,
      },
    });

    if (!pitch) {
      return res.status(404).json({ message: 'Pitch not found' });
    }

    // Check if this is a client-created campaign OR v4 campaign (admin-created with client managers)
    if (pitch.campaign.origin !== 'CLIENT' && pitch.campaign.submissionVersion !== 'v4') {
      return res.status(400).json({ message: 'This endpoint is only for client-created campaigns or v4 campaigns' });
    }

    // Check if pitch is in correct status
    if (pitch.status !== 'APPROVED') {
      return res.status(400).json({ message: 'Pitch is not in correct status for agreement setup' });
    }

    // Update pitch status and set agreement details
    await prisma.pitch.update({
      where: { id: pitchId },
      data: {
        status: 'AGREEMENT_PENDING',
        amount: amount ? (typeof amount === 'string' ? parseInt(amount) : amount) : null,
        agreementTemplateId: agreementTemplateId,
      },
    });

    // Create notification for creator
    await prisma.notification.create({
      data: {
        title: 'Agreement Ready',
        message: `An agreement has been prepared for your pitch on campaign "${pitch.campaign.name}". Please review and submit.`,
        entity: 'Pitch',
        campaignId: pitch.campaignId,
        pitchId: pitchId,
        userId: pitch.userId,
      },
    });

    console.log(`Agreement set for pitch ${pitchId}, status updated to PENDING_CREATOR_AGREEMENT`);
    return res.status(200).json({ message: 'Agreement set and sent to creator for review' });
  } catch (error) {
    console.error('Error setting pitch agreement:', error);
    return res.status(500).json({ message: 'Failed to set agreement' });
  }
};

// V3 Flow: Creator submits agreement
export const submitAgreement = async (req: Request, res: Response) => {
  const { pitchId } = req.params;
  const creatorId = req.session.userid;

  try {
    console.log(`Creator ${creatorId} submitting agreement for pitch ${pitchId}`);

    const pitch = await prisma.pitch.findUnique({
      where: { id: pitchId },
      include: {
        campaign: {
          include: {
            campaignAdmin: {
              include: {
                admin: {
                  include: {
                    user: true,
                  },
                },
              },
            },
          },
        },
        user: true,
      },
    });

    if (!pitch) {
      return res.status(404).json({ message: 'Pitch not found' });
    }

    // Verify creator owns this pitch
    if (pitch.userId !== creatorId) {
      return res.status(403).json({ message: 'You can only submit agreements for your own pitches' });
    }

    // Check if this is a client-created campaign OR v4 campaign (admin-created with client managers)
    if (pitch.campaign.origin !== 'CLIENT' && pitch.campaign.submissionVersion !== 'v4') {
      return res.status(400).json({ message: 'This endpoint is only for client-created campaigns or v4 campaigns' });
    }

    // Check if pitch is in correct status for agreement submission
    // Allow AGREEMENT_PENDING (initial submission) and AGREEMENT_SUBMITTED (when resubmitting after changes requested)
    if (pitch.status !== 'AGREEMENT_PENDING' && pitch.status !== 'AGREEMENT_SUBMITTED') {
      return res.status(400).json({
        message: `Pitch is not in correct status for agreement submission. Current status: ${pitch.status}`,
      });
    }

    // If pitch is already AGREEMENT_SUBMITTED, check if the agreement submission needs changes
    if (pitch.status === 'AGREEMENT_SUBMITTED') {
      const agreementSubmission = await prisma.submission.findFirst({
        where: {
          userId: pitch.userId,
          campaignId: pitch.campaignId,
          submissionType: {
            type: 'AGREEMENT_FORM',
          },
        },
      });

      // Only allow resubmission if agreement submission is in CHANGES_REQUIRED status
      if (!agreementSubmission || agreementSubmission.status !== 'CHANGES_REQUIRED') {
        return res.status(400).json({
          message: 'Agreement has already been submitted and is not pending changes',
        });
      }
    }

    // Update pitch status to completed
    await prisma.pitch.update({
      where: { id: pitchId },
      data: {
        status: 'AGREEMENT_SUBMITTED',
        completedAt: new Date(),
      },
    });

    // Update submission status from IN_PROGRESS to PENDING_REVIEW
    await prisma.submission.updateMany({
      where: {
        userId: pitch.userId,
        campaignId: pitch.campaignId,
        submissionType: {
          type: 'AGREEMENT_FORM',
        },
      },
      data: {
        status: 'PENDING_REVIEW',
      },
    });

    // Note: Creator agreement record creation skipped due to schema mismatch
    // TODO: Update CreatorAgreement model to match V3 flow requirements

    // Create notification for admin and client
    const adminAndClientUsers = pitch.campaign.campaignAdmin.filter(
      (ca) => ca.admin.user.role === 'admin' || ca.admin.user.role === 'superadmin' || ca.admin.user.role === 'client',
    );

    for (const user of adminAndClientUsers) {
      await prisma.notification.create({
        data: {
          title: 'Agreement Submitted',
          message: `Creator has submitted agreement for campaign "${pitch.campaign.name}".`,
          entity: 'Pitch',
          campaignId: pitch.campaignId,
          pitchId: pitchId,
          userId: user.admin.userId,
        },
      });
    }

    // Log campaign activity for agreement submission
    await prisma.campaignLog.create({
      data: {
        message: `${pitch.user.name || 'Creator'} submitted agreement`,
        adminId: creatorId,
        campaignId: pitch.campaignId,
      },
    });

    console.log(`Agreement submitted for pitch ${pitchId}, status updated to AGREEMENT_SUBMITTED`);
    return res.status(200).json({ message: 'Agreement submitted successfully' });
  } catch (error) {
    console.error('Error submitting agreement:', error);
    return res.status(500).json({ message: 'Failed to submit agreement' });
  }
};

// Get pitches for v3 flow with role-based status display
export const getPitchesV3 = async (req: Request, res: Response) => {
  const { campaignId, status } = req.query;
  const userId = req.session.userid;

  try {
    // Get user role
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }

    const whereClause: any = {};

    if (campaignId) {
      whereClause.campaignId = campaignId as string;
    }

    if (status) {
      whereClause.status = status as string;
    }

    const pitches = await prisma.pitch.findMany({
      where: {
        ...whereClause,
      },
      include: {
        campaign: true,
        user: {
          include: {
            creator: {
              include: {
                instagramUser: true,
                tiktokUser: true,
                mediaKit: true,
              },
            },
          },
        },
        admin: {
          include: {
            user: true,
          },
        },
        client: true,
        rejectedByAdmin: {
          include: {
            user: true,
          },
        },
        rejectedByClient: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    console.log('🔍 V3 Pitches Debug:', {
      campaignId,
      requestedStatus: status,
      userRole: user.role,
      totalPitches: pitches.length,
      v4Pitches: pitches.filter((p) => p.campaign?.submissionVersion === 'v4').length,
      v2Pitches: pitches.filter((p) => p.campaign?.submissionVersion === 'v2').length,
      pitchStatuses: pitches.map((p) => ({
        id: p.id,
        status: p.status,
        campaignOrigin: p.campaign?.origin,
        submissionVersion: p.campaign?.submissionVersion,
      })),
    });

    const transformedPitches = pitches
      .filter((pitch) => {
        const normalizedStatus = normalizePitchStatusForV4(pitch);

        if (user.role === 'client') {
          return (
            normalizedStatus === 'SENT_TO_CLIENT' ||
            normalizedStatus === 'APPROVED' ||
            normalizedStatus === 'REJECTED' ||
            normalizedStatus === 'MAYBE' ||
            normalizedStatus === 'AGREEMENT_PENDING' ||
            normalizedStatus === 'AGREEMENT_SUBMITTED'
          );
        }
        return true;
      })
      .map((pitch) => {
        const normalizedStatus = normalizePitchStatusForV4(pitch);
        let displayStatus: string | null = normalizedStatus;

        if (user.role === 'admin' || user.role === 'superadmin') {
          if (normalizedStatus === 'SENT_TO_CLIENT' && pitch.adminComments) {
            displayStatus = 'SENT_TO_CLIENT_WITH_COMMENTS';
          } else {
            displayStatus = normalizedStatus;
          }
        } else if (user.role === 'client') {
          if (normalizedStatus === 'SENT_TO_CLIENT') {
            displayStatus = 'PENDING_REVIEW';
          } else if (normalizedStatus === 'AGREEMENT_PENDING' || normalizedStatus === 'AGREEMENT_SUBMITTED') {
            displayStatus = 'APPROVED';
          }
        } else if (user.role === 'creator') {
          if (normalizedStatus === 'SENT_TO_CLIENT') {
            displayStatus = 'PENDING_REVIEW';
          } else if (normalizedStatus === 'AGREEMENT_PENDING' || normalizedStatus === 'AGREEMENT_SUBMITTED') {
            displayStatus = 'APPROVED';
          }
        }

        let sanitizedUser = undefined;
        if (pitch.user) {
          const { password, xeroRefreshToken, ...restUser } = pitch.user;
          sanitizedUser = { ...restUser };
        }

        return {
          ...pitch,
          status: normalizedStatus,
          user: sanitizedUser,
          displayStatus, // Add display status for frontend
        };
      });

    return res.status(200).json(transformedPitches);
  } catch (error) {
    console.error('Error getting v3 pitches:', error);
    return res.status(500).json({ message: 'Failed to get pitches' });
  }
};

// Get single pitch with role-based status display
export const getPitchByIdV3 = async (req: Request, res: Response) => {
  const { pitchId } = req.params;
  const userId = req.session.userid;

  try {
    // Get user role
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }

    const pitch = await prisma.pitch.findUnique({
      where: { id: pitchId },
      include: {
        campaign: true,
        user: {
          include: {
            creator: {
              include: {
                instagramUser: true,
                tiktokUser: true,
                mediaKit: true,
              },
            },
          },
        },
        admin: {
          include: {
            user: true,
          },
        },
        client: true,
        rejectedByAdmin: {
          include: {
            user: true,
          },
        },
        rejectedByClient: true,
      },
    });

    if (!pitch) {
      return res.status(404).json({ message: 'Pitch not found' });
    }

    // Check if this is a client-created campaign OR v4 campaign (admin-created with client managers)
    if (pitch.campaign.origin !== 'CLIENT' && pitch.campaign.submissionVersion !== 'v4') {
      return res.status(400).json({ message: 'This endpoint is only for client-created campaigns or v4 campaigns' });
    }

    // For clients: only allow access to pitches that are SENT_TO_CLIENT or APPROVED
    // Hide pitches with PENDING_REVIEW status (admin review stage)
    if (user.role === 'client' && pitch.status === 'PENDING_REVIEW') {
      return res.status(403).json({ message: 'Access denied. This pitch is still under admin review.' });
    }

    // Set status based on adminComments

    // Transform pitch to show role-based status
    let displayStatus: string | null = pitch.status;

    // Role-based status display logic
    if (user.role === 'admin' || user.role === 'superadmin') {
      // Admin sees: PENDING_REVIEW -> PENDING_REVIEW, SENT_TO_CLIENT -> SENT_TO_CLIENT, APPROVED -> APPROVED
      if (pitch.status === 'SENT_TO_CLIENT' && pitch.adminComments) {
        displayStatus = 'SENT_TO_CLIENT_WITH_COMMENTS';
      }
    } else if (user.role === 'client') {
      // Client sees: SENT_TO_CLIENT -> PENDING_REVIEW, APPROVED -> APPROVED
      if (pitch.status === 'SENT_TO_CLIENT') {
        displayStatus = 'PENDING_REVIEW';
      }
    } else if (user.role === 'creator') {
      // Creator sees: PENDING_REVIEW -> PENDING_REVIEW, SENT_TO_CLIENT -> PENDING_REVIEW, APPROVED -> APPROVED
      if (pitch.status === 'SENT_TO_CLIENT') {
        displayStatus = 'PENDING_REVIEW';
      }
    }

    const transformedPitch = {
      ...pitch,
      displayStatus, // Add display status for frontend
    };

    return res.status(200).json(transformedPitch);
  } catch (error) {
    console.error('Error getting pitch by ID:', error);
    return res.status(500).json({ message: 'Failed to get pitch' });
  }
};

// V3 Draft Submission Flow Functions

// V3: Creator submits draft (First Draft or Final Draft)
export const submitDraftV3 = async (req: Request, res: Response) => {
  const { submissionId, caption, photosDriveLink, rawFootagesDriveLink } = JSON.parse(req.body.data);
  const files = req.files as any;
  const creatorId = req.session.userid;

  try {
    console.log(`Creator ${creatorId} submitting draft V3 for submission ${submissionId}`);

    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        submissionType: true,
        user: true,
        campaign: {
          include: {
            campaignAdmin: {
              include: {
                admin: {
                  include: {
                    user: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    // Verify creator owns this submission
    if (submission.userId !== creatorId) {
      return res.status(403).json({ message: 'You can only submit drafts for your own submissions' });
    }

    // Check if this is a client-created campaign OR v4 campaign (admin-created with client managers)
    if (submission.campaign.origin !== 'CLIENT' && submission.campaign.submissionVersion !== 'v4') {
      return res.status(400).json({ message: 'This endpoint is only for client-created campaigns or v4 campaigns' });
    }

    // Check if submission is in correct status
    if (submission.status !== 'IN_PROGRESS' && submission.status !== 'CHANGES_REQUIRED') {
      return res.status(400).json({
        message: `Submission is not in correct status for draft submission. Current status: ${submission.status}`,
      });
    }

    // Handle file uploads (simplified for now - you can add the full file processing logic here)
    // This is a placeholder - you'll need to implement the actual file upload logic

    // Update submission status to PENDING_REVIEW (admin review)
    await prisma.submission.update({
      where: { id: submissionId },
      data: {
        status: 'PENDING_REVIEW',
        submissionDate: new Date(),
        content: caption || null,
        photosDriveLink: photosDriveLink || null,
        rawFootagesDriveLink: rawFootagesDriveLink || null,
      },
    });

    // Create notification for admin users
    const adminUsers = submission.campaign.campaignAdmin.filter(
      (ca) => ca.admin.user.role === 'admin' || ca.admin.user.role === 'superadmin',
    );

    for (const adminUser of adminUsers) {
      await prisma.notification.create({
        data: {
          title: 'Draft Submitted for Review',
          message: `A ${submission.submissionType.type.toLowerCase().replace('_', ' ')} has been submitted for campaign "${submission.campaign.name}".`,
          entity: 'Draft',
          campaignId: submission.campaignId,
          userId: adminUser.admin.userId,
        },
      });
    }

    console.log(`Draft submitted for submission ${submissionId}, status updated to PENDING_REVIEW`);
    return res.status(200).json({ message: 'Draft submitted successfully for admin review' });
  } catch (error) {
    console.error('Error submitting draft V3:', error);
    return res.status(500).json({ message: 'Failed to submit draft' });
  }
};

// V3: Admin approves draft and sends to client
export const approveDraftByAdminV3 = async (req: Request, res: Response) => {
  const { submissionId, feedback } = req.body;
  const adminId = req.session.userid;

  try {
    console.log(`Admin ${adminId} approving draft V3 for submission ${submissionId}`);

    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        submissionType: true,
        user: true,
        campaign: {
          include: {
            campaignAdmin: {
              include: {
                admin: {
                  include: {
                    user: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    // Check if this is a client-created campaign
    if (submission.campaign.origin !== 'CLIENT' && submission.campaign.submissionVersion !== 'v4') {
      return res.status(400).json({ message: 'This endpoint is only for client-created campaigns or v4 campaigns' });
    }

    // Check if submission is in correct status
    if (submission.status !== 'PENDING_REVIEW') {
      return res.status(400).json({
        message: `Submission is not in correct status for admin approval. Current status: ${submission.status}`,
      });
    }

    // Update submission status to SENT_TO_CLIENT
    await prisma.submission.update({
      where: { id: submissionId },
      data: {
        status: 'SENT_TO_CLIENT',
        approvedByAdminId: adminId,
        completedAt: new Date(),
      },
    });

    // Add feedback if provided
    if (feedback) {
      await prisma.feedback.create({
        data: {
          content: feedback,
          type: 'COMMENT',
          adminId: adminId,
          submissionId: submissionId,
        },
      });
    }

    // Create notification for client users
    const clientUsers = submission.campaign.campaignAdmin.filter((ca) => ca.admin.user.role === 'client');

    for (const clientUser of clientUsers) {
      await prisma.notification.create({
        data: {
          title: 'Draft Sent to Client',
          message: `A ${submission.submissionType.type.toLowerCase().replace('_', ' ')} has been approved by admin and sent to you for review.`,
          entity: 'Draft',
          campaignId: submission.campaignId,
          userId: clientUser.admin.userId,
        },
      });
    }

    console.log(`Draft ${submissionId} approved by admin, status updated to SENT_TO_CLIENT`);
    return res.status(200).json({ message: 'Draft approved and sent to client for review' });
  } catch (error) {
    console.error('Error approving draft by admin V3:', error);
    return res.status(500).json({ message: 'Failed to approve draft' });
  }
};

// V3: Admin requests changes for draft
export const requestChangesByAdminV3 = async (req: Request, res: Response) => {
  const { submissionId, feedback, reasons } = req.body;
  const adminId = req.session.userid;

  try {
    console.log(`Admin ${adminId} requesting changes for draft V3 submission ${submissionId}`);

    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        submissionType: true,
        user: true,
        campaign: true,
      },
    });

    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    // Check if this is a client-created campaign
    if (submission.campaign.origin !== 'CLIENT' && submission.campaign.submissionVersion !== 'v4') {
      return res.status(400).json({ message: 'This endpoint is only for client-created campaigns or v4 campaigns' });
    }

    // Check if submission is in correct status
    if (submission.status !== 'PENDING_REVIEW') {
      return res.status(400).json({
        message: `Submission is not in correct status for changes request. Current status: ${submission.status}`,
      });
    }

    // Update submission status to CHANGES_REQUIRED
    await prisma.submission.update({
      where: { id: submissionId },
      data: {
        status: 'CHANGES_REQUIRED',
        approvedByAdminId: adminId,
        completedAt: new Date(),
      },
    });

    // Add feedback
    await prisma.feedback.create({
      data: {
        content: feedback,
        type: 'REASON',
        reasons: reasons,
        adminId: adminId,
        submissionId: submissionId,
      },
    });

    // Create notification for creator
    await prisma.notification.create({
      data: {
        title: 'Changes Requested',
        message: `Changes have been requested for your ${submission.submissionType.type.toLowerCase().replace('_', ' ')} in campaign "${submission.campaign.name}".`,
        entity: 'Draft',
        campaignId: submission.campaignId,
        userId: submission.userId,
      },
    });

    console.log(`Changes requested for draft ${submissionId}, status updated to CHANGES_REQUIRED`);
    return res.status(200).json({ message: 'Changes requested successfully' });
  } catch (error) {
    console.error('Error requesting changes by admin V3:', error);
    return res.status(500).json({ message: 'Failed to request changes' });
  }
};

// V3: Client approves draft
export const approveDraftByClientV3 = async (req: Request, res: Response) => {
  const { submissionId, feedback } = req.body;
  const clientId = req.session.userid;

  try {
    console.log(`Client ${clientId} approving draft V3 for submission ${submissionId}`);

    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        submissionType: true,
        user: true,
        campaign: {
          include: {
            campaignAdmin: {
              include: {
                admin: {
                  include: {
                    user: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    // Check if this is a client-created campaign
    if (submission.campaign.origin !== 'CLIENT' && submission.campaign.submissionVersion !== 'v4') {
      return res.status(400).json({ message: 'This endpoint is only for client-created campaigns or v4 campaigns' });
    }

    // Check if submission is in correct status
    if (submission.status !== 'SENT_TO_CLIENT') {
      return res.status(400).json({
        message: `Submission is not in correct status for client approval. Current status: ${submission.status}`,
      });
    }

    // Verify client has access to this campaign
    const clientAccess = submission.campaign.campaignAdmin.find(
      (ca) => ca.admin.userId === clientId && ca.admin.user.role === 'client',
    );

    if (!clientAccess) {
      return res.status(403).json({ message: 'Client not authorized for this campaign' });
    }

    // Update submission status to CLIENT_APPROVED
    await prisma.submission.update({
      where: { id: submissionId },
      data: {
        status: 'CLIENT_APPROVED',
        completedAt: new Date(),
      },
    });

    // Add feedback if provided
    if (feedback) {
      await prisma.feedback.create({
        data: {
          content: feedback,
          type: 'COMMENT',
          adminId: clientId,
          submissionId: submissionId,
        },
      });
    }

    // Check if this is the final step (posting submission)
    if (submission.submissionType.type === 'POSTING') {
      // Generate invoice or mark campaign as completed
      console.log(`Posting approved by client - campaign ${submission.campaignId} completed`);
      // TODO: Add invoice generation logic here
    } else {
      // Activate next submission in the workflow
      const nextSubmission = await prisma.submission.findFirst({
        where: {
          userId: submission.userId,
          campaignId: submission.campaignId,
          submissionType: {
            type: submission.submissionType.type === 'FIRST_DRAFT' ? 'FINAL_DRAFT' : 'POSTING',
          },
        },
      });

      if (nextSubmission) {
        await prisma.submission.update({
          where: { id: nextSubmission.id },
          data: {
            status: 'IN_PROGRESS',
            nextsubmissionDate: new Date(),
          },
        });
      }
    }

    // Create notification for admin and creator
    const adminUsers = submission.campaign.campaignAdmin.filter(
      (ca) => ca.admin.user.role === 'admin' || ca.admin.user.role === 'superadmin',
    );

    // Determine entity based on submission type - this is a client action
    const clientEntity = getEntityFromSubmissionType(submission.submissionType.type, 'client');

    for (const adminUser of adminUsers) {
      await prisma.notification.create({
        data: {
          title: 'Draft Approved by Client',
          message: `A ${submission.submissionType.type.toLowerCase().replace('_', ' ')} has been approved by client for campaign "${submission.campaign.name}".`,
          entity: clientEntity as any,
          campaignId: submission.campaignId,
          userId: adminUser.admin.userId,
        },
      });
    }

    // Notify creator - use generic entity for creator notifications
    const creatorEntity = getEntityFromSubmissionType(submission.submissionType.type);

    await prisma.notification.create({
      data: {
        title: 'Draft Approved',
        message: `Your ${submission.submissionType.type.toLowerCase().replace('_', ' ')} has been approved by client for campaign "${submission.campaign.name}".`,
        entity: creatorEntity as any,
        campaignId: submission.campaignId,
        userId: submission.userId,
      },
    });

    console.log(`Draft ${submissionId} approved by client, status updated to CLIENT_APPROVED`);
    return res.status(200).json({ message: 'Draft approved by client' });
  } catch (error) {
    console.error('Error approving draft by client V3:', error);
    return res.status(500).json({ message: 'Failed to approve draft' });
  }
};

// V3: Client requests changes for draft
export const requestChangesByClientV3 = async (req: Request, res: Response) => {
  const { submissionId, feedback, reasons } = req.body;
  const clientId = req.session.userid;

  try {
    console.log(`Client ${clientId} requesting changes for draft V3 submission ${submissionId}`);

    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        submissionType: true,
        user: true,
        campaign: {
          include: {
            campaignAdmin: {
              include: {
                admin: {
                  include: {
                    user: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    // Check if this is a client-created campaign
    if (submission.campaign.origin !== 'CLIENT' && submission.campaign.submissionVersion !== 'v4') {
      return res.status(400).json({ message: 'This endpoint is only for client-created campaigns or v4 campaigns' });
    }

    // Check if submission is in correct status
    if (submission.status !== 'SENT_TO_CLIENT') {
      return res.status(400).json({
        message: `Submission is not in correct status for changes request. Current status: ${submission.status}`,
      });
    }

    // Verify client has access to this campaign
    const clientAccess = submission.campaign.campaignAdmin.find(
      (ca) => ca.admin.userId === clientId && ca.admin.user.role === 'client',
    );

    if (!clientAccess) {
      return res.status(403).json({ message: 'Client not authorized for this campaign' });
    }

    // Update submission status to SENT_TO_ADMIN
    await prisma.submission.update({
      where: { id: submissionId },
      data: {
        status: 'SENT_TO_ADMIN',
        completedAt: new Date(),
      },
    });

    // Add feedback
    await prisma.feedback.create({
      data: {
        content: feedback,
        type: 'REASON',
        reasons: reasons,
        adminId: clientId,
        submissionId: submissionId,
      },
    });

    // Create notification for admin
    const adminUsers = submission.campaign.campaignAdmin.filter(
      (ca) => ca.admin.user.role === 'admin' || ca.admin.user.role === 'superadmin',
    );

    // Determine entity based on submission type
    const entity = getEntityFromSubmissionType(submission.submissionType.type, 'client');

    for (const adminUser of adminUsers) {
      await prisma.notification.create({
        data: {
          title: 'Client Requested Changes',
          message: `Client has requested changes for ${submission.submissionType.type.toLowerCase().replace('_', ' ')} in campaign "${submission.campaign.name}".`,
          entity: entity as any,
          campaignId: submission.campaignId,
          userId: adminUser.admin.userId,
        },
      });
    }

    console.log(`Changes requested by client for draft ${submissionId}, status updated to SENT_TO_ADMIN`);
    return res.status(200).json({ message: 'Changes requested by client' });
  } catch (error) {
    console.error('Error requesting changes by client V3:', error);
    return res.status(500).json({ message: 'Failed to request changes' });
  }
};

// V3: Admin reviews client feedback and forwards to creator
export const forwardClientFeedbackV3 = async (req: Request, res: Response) => {
  const { submissionId, adminFeedback } = req.body;
  const adminId = req.session.userid;

  try {
    console.log(`Admin ${adminId} forwarding client feedback for submission ${submissionId}`);

    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        submissionType: true,
        user: true,
        campaign: true,
      },
    });

    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    // Check if this is a client-created campaign
    if (submission.campaign.origin !== 'CLIENT' && submission.campaign.submissionVersion !== 'v4') {
      return res.status(400).json({ message: 'This endpoint is only for client-created campaigns or v4 campaigns' });
    }

    // Check if submission is in correct status
    if (submission.status !== 'SENT_TO_ADMIN') {
      return res.status(400).json({
        message: `Submission is not in correct status for forwarding feedback. Current status: ${submission.status}`,
      });
    }

    // Only update status if it's currently SENT_TO_ADMIN, otherwise keep it as CHANGES_REQUIRED
    if (submission.status === 'SENT_TO_ADMIN') {
      await prisma.submission.update({
        where: { id: submissionId },
        data: {
          status: 'CHANGES_REQUIRED',
        },
      });
    }

    // Add admin's review of client feedback
    if (adminFeedback) {
      await prisma.feedback.create({
        data: {
          content: adminFeedback,
          type: 'COMMENT',
          adminId: adminId,
          submissionId: submissionId,
        },
      });
    }

    // Create notification for creator - this is an admin action
    const adminEntity = getEntityFromSubmissionType(submission.submissionType.type, 'admin');

    await prisma.notification.create({
      data: {
        title: 'Changes Required',
        message: `Changes have been requested for your ${submission.submissionType.type.toLowerCase().replace('_', ' ')} in campaign "${submission.campaign.name}". Please review the feedback and resubmit.`,
        entity: adminEntity as any,
        campaignId: submission.campaignId,
        userId: submission.userId,
      },
    });

    console.log(`Client feedback forwarded for submission ${submissionId}, status updated to CHANGES_REQUIRED`);
    return res.status(200).json({ message: 'Client feedback forwarded to creator' });
  } catch (error) {
    console.error('Error forwarding client feedback V3:', error);
    return res.status(500).json({ message: 'Failed to forward feedback' });
  }
};

// Update guest creator information
export const updateGuestCreatorInfo = async (req: Request, res: Response) => {
  const { pitchId } = req.params;
  const { name, followerCount, engagementRate, profileLink, adminComments } = req.body;
  const userId = req.session.userid;

  try {
    console.log(`User ${userId} updating guest creator info for pitch ${pitchId}`);

    // Find the pitch with user information
    const pitch = await prisma.pitch.findUnique({
      where: { id: pitchId },
      include: {
        user: {
          include: {
            creator: true,
          },
        },
      },
    });

    if (!pitch) {
      return res.status(404).json({ message: 'Pitch not found' });
    }

    // Check if the user is a guest creator
    const isGuest =
      pitch.user?.email?.includes('@tempmail.com') ||
      pitch.user?.email?.startsWith('guest_') ||
      pitch.user?.creator?.isGuest === true;

    if (!isGuest) {
      return res.status(400).json({ message: 'This endpoint is only for guest creators' });
    }

    // Validate required fields
    if (!name?.trim() || !profileLink?.trim()) {
      return res.status(400).json({ message: 'Creator name and profile link are required' });
    }

    // Update user name
    await prisma.user.update({
      where: { id: pitch.userId },
      data: {
        name: name.trim(),
      },
    });

    // Update creator profileLink (single source of truth for profile links)
    if (pitch.user?.creator) {
      await prisma.creator.update({
        where: { userId: pitch.userId },
        data: {
          profileLink: profileLink.trim(),
        },
      });
    }

    // Update pitch with followerCount and adminComments
    const pitchUpdateData: any = {};

    const fieldsToUpdate = {
      followerCount,
      engagementRate,
      adminComments,
    };

    Object.entries(fieldsToUpdate).forEach(([key, value]) => {
      if (value !== undefined) {
        pitchUpdateData[key] = value?.trim?.() || null;
      }
    });

    if (Object.keys(pitchUpdateData).length > 0) {
      await prisma.pitch.update({
        where: { id: pitchId },
        data: pitchUpdateData,
      });
    }

    console.log(`Guest creator info updated for pitch ${pitchId}`);
    return res.status(200).json({
      message: 'Guest creator information updated successfully',
      data: {
        name: name.trim(),
        followerCount: followerCount?.trim?.() || null,
        engagementRate: engagementRate?.trim?.() || null,
        profileLink: profileLink.trim(),
        adminComments: adminComments?.trim() || null,
      },
    });
  } catch (error) {
    console.error('Error updating guest creator info:', error);
    return res.status(500).json({ message: 'Failed to update guest creator information' });
  }
};

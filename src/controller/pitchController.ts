import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import dayjs from 'dayjs';

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

// New Flow: Admin approves pitch and sends to client
export const approvePitchByAdmin = async (req: Request, res: Response) => {
  const { pitchId } = req.params;
  const { ugcCredits, feedback } = req.body;
  const adminId = req.session.userid;

  try {
    console.log(`Admin ${adminId} approving pitch ${pitchId} with ${ugcCredits} UGC credits`);

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

    // Check if this is a client-created campaign
    if (pitch.campaign.origin !== 'CLIENT') {
      return res.status(400).json({ message: 'This endpoint is only for client-created campaigns' });
    }

    // Check if pitch is in correct status
    if (pitch.status !== 'PENDING_REVIEW') {
      return res.status(400).json({ message: 'Pitch is not in correct status for admin approval' });
    }

    // Validate UGC credits
    if (!ugcCredits || isNaN(ugcCredits) || parseInt(ugcCredits) <= 0) {
      return res.status(400).json({ message: 'Valid UGC credits are required' });
    }

    // Update pitch status to sent to client and store UGC credits
    const updatedPitch = await prisma.pitch.update({
      where: { id: pitchId },
      data: {
        status: 'SENT_TO_CLIENT',
        approvedByAdminId: adminId,
        ugcCredits: parseInt(ugcCredits),
      },
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

    // Find client users for this campaign
    const clientUsers = pitch.campaign.campaignAdmin.filter((ca) => ca.admin.user.role === 'client');

    for (const clientUser of clientUsers) {
      await prisma.notification.create({
        data: {
          title: 'Pitch Sent to Client',
          message: `A pitch for campaign "${pitch.campaign.name}" has been approved by admin and sent to you for review.`,
          entity: 'Pitch',
          campaignId: pitch.campaignId,
          pitchId: pitchId,
          userId: clientUser.admin.userId,
        },
      });
    }

    console.log(`Pitch ${pitchId} approved by admin with ${ugcCredits} UGC credits, status updated to SENT_TO_CLIENT`);
    return res.status(200).json({
      message: 'Pitch approved and sent to client for review',
      pitch: updatedPitch,
    });
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

    // Check if this is a client-created campaign
    if (pitch.campaign.origin !== 'CLIENT') {
      return res.status(400).json({ message: 'This endpoint is only for client-created campaigns' });
    }

    // Check if pitch is in correct status
    if (pitch.status !== 'PENDING_REVIEW') {
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
    await prisma.notification.create({
      data: {
        title: 'Pitch Rejected',
        message: `Your pitch for campaign "${pitch.campaign.name}" has been rejected by admin.`,
        entity: 'Pitch',
        campaignId: pitch.campaignId,
        pitchId: pitchId,
        userId: pitch.userId,
      },
    });

    console.log(`Pitch ${pitchId} rejected by admin, creator removed from campaign`);
    return res.status(200).json({ message: 'Pitch rejected and creator removed from campaign' });
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

    // Check if this is a client-created campaign
    if (pitch.campaign.origin !== 'CLIENT') {
      return res.status(400).json({ message: 'This endpoint is only for client-created campaigns' });
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

    // Update pitch status to approved (both admin and client see this as approved)
    await prisma.pitch.update({
      where: { id: pitchId },
      data: {
        status: 'APPROVED',
        approvedByClientId: clientId,
      },
    });

    // Create ShortListedCreator record for V3 approved pitches
    // This ensures the creator appears in the Shortlisted Creator section
    await prisma.shortListedCreator.upsert({
      where: {
        userId_campaignId: {
          userId: pitch.userId,
          campaignId: pitch.campaignId,
        },
      },
      update: {
        isAgreementReady: false, // Not ready yet, waiting for agreement setup
      },
      create: {
        userId: pitch.userId,
        campaignId: pitch.campaignId,
        isAgreementReady: false, // Not ready yet, waiting for agreement setup
      },
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
        // Create submissions for all timeline items
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

        // Create dependencies between submissions
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

        console.log(`Created ${submissions.length} submissions for V3 pitch approval`);
      }
    }

    // Find admin users for this campaign
    const adminUsers = pitch.campaign.campaignAdmin.filter(
      (ca) => ca.admin.user.role === 'admin' || ca.admin.user.role === 'superadmin',
    );

    for (const adminUser of adminUsers) {
      await prisma.notification.create({
        data: {
          title: 'Pitch Approved by Client',
          message: `A pitch for campaign "${pitch.campaign.name}" has been approved by client and is ready for agreement setup.`,
          entity: 'Pitch',
          campaignId: pitch.campaignId,
          pitchId: pitchId,
          userId: adminUser.admin.userId,
        },
      });
    }

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

    // Check if this is a client-created campaign
    if (pitch.campaign.origin !== 'CLIENT') {
      return res.status(400).json({ message: 'This endpoint is only for client-created campaigns' });
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
    await prisma.notification.create({
      data: {
        title: 'Pitch Rejected',
        message: `Your pitch for campaign "${pitch.campaign.name}" has been rejected by client.`,
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
          title: 'Pitch Rejected by Client',
          message: `A pitch for campaign "${pitch.campaign.name}" has been rejected by client.`,
          entity: 'Pitch',
          campaignId: pitch.campaignId,
          pitchId: pitchId,
          userId: adminUser.admin.userId,
        },
      });
    }

    console.log(`Pitch ${pitchId} rejected by client, creator removed from campaign`);
    return res.status(200).json({ message: 'Pitch rejected and creator removed from campaign' });
  } catch (error) {
    console.error('Error rejecting pitch by client:', error);
    return res.status(500).json({ message: 'Failed to reject pitch' });
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

    // Check if this is a client-created campaign
    if (pitch.campaign.origin !== 'CLIENT') {
      return res.status(400).json({ message: 'This endpoint is only for client-created campaigns' });
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

    // Check if this is a client-created campaign
    if (pitch.campaign.origin !== 'CLIENT') {
      return res.status(400).json({ message: 'This endpoint is only for client-created campaigns' });
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

    // Check if this is a client-created campaign
    if (pitch.campaign.origin !== 'CLIENT') {
      return res.status(400).json({ message: 'This endpoint is only for client-created campaigns' });
    }

    // Check if pitch is in correct status
    if (pitch.status !== 'AGREEMENT_PENDING') {
      return res.status(400).json({ message: 'Pitch is not in correct status for agreement submission' });
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

    // Only get pitches for client-created campaigns
    const pitches = await prisma.pitch.findMany({
      where: {
        ...whereClause,
        campaign: {
          origin: 'CLIENT',
        },
      },
      include: {
        campaign: true,
        user: true,
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

    // Transform pitches to show role-based status and filter for clients
    const transformedPitches = pitches
      .filter((pitch) => {
        // For clients: only show pitches that are SENT_TO_CLIENT or APPROVED
        // Hide pitches with PENDING_REVIEW status (admin review stage)
        if (user.role === 'client') {
          return pitch.status === 'SENT_TO_CLIENT' || pitch.status === 'APPROVED';
        }
        // For admin and creators: show all pitches
        return true;
      })
      .map((pitch) => {
        let displayStatus = pitch.status;

        // Role-based status display logic
        if (user.role === 'admin' || user.role === 'superadmin') {
          // Admin sees: PENDING_REVIEW -> PENDING_REVIEW, SENT_TO_CLIENT -> SENT_TO_CLIENT, APPROVED -> APPROVED
          displayStatus = pitch.status;
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

        return {
          ...pitch,
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
        user: true,
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

    // Check if this is a client-created campaign
    if (pitch.campaign.origin !== 'CLIENT') {
      return res.status(400).json({ message: 'This endpoint is only for client-created campaigns' });
    }

    // For clients: only allow access to pitches that are SENT_TO_CLIENT or APPROVED
    // Hide pitches with PENDING_REVIEW status (admin review stage)
    if (user.role === 'client' && pitch.status === 'PENDING_REVIEW') {
      return res.status(403).json({ message: 'Access denied. This pitch is still under admin review.' });
    }

    // Transform pitch to show role-based status
    let displayStatus = pitch.status;

    // Role-based status display logic
    if (user.role === 'admin' || user.role === 'superadmin') {
      // Admin sees: PENDING_REVIEW -> PENDING_REVIEW, SENT_TO_CLIENT -> SENT_TO_CLIENT, APPROVED -> APPROVED
      displayStatus = pitch.status;
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

    // Check if this is a client-created campaign
    if (submission.campaign.origin !== 'CLIENT') {
      return res.status(400).json({ message: 'This endpoint is only for client-created campaigns' });
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
    if (submission.campaign.origin !== 'CLIENT') {
      return res.status(400).json({ message: 'This endpoint is only for client-created campaigns' });
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
    if (submission.campaign.origin !== 'CLIENT') {
      return res.status(400).json({ message: 'This endpoint is only for client-created campaigns' });
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
    if (submission.campaign.origin !== 'CLIENT') {
      return res.status(400).json({ message: 'This endpoint is only for client-created campaigns' });
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
    if (submission.campaign.origin !== 'CLIENT') {
      return res.status(400).json({ message: 'This endpoint is only for client-created campaigns' });
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
    if (submission.campaign.origin !== 'CLIENT') {
      return res.status(400).json({ message: 'This endpoint is only for client-created campaigns' });
    }

    // Check if submission is in correct status - allow both SENT_TO_ADMIN and CHANGES_REQUIRED
    if (submission.status !== 'SENT_TO_ADMIN' && submission.status !== 'CHANGES_REQUIRED') {
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

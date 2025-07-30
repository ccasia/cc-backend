import { Request, Response } from 'express';
import { PrismaClient, Entity } from '@prisma/client';
import amqplib from 'amqplib';
import fs from 'fs';
import path from 'path';
import { activeProcesses } from '../server';
import { getCreatorInvoiceLists } from '../service/submissionService';
import { createInvoiceService } from '../service/invoiceService';

const prisma = new PrismaClient();

// Get submissions for V3 flow with role-based status display
export const getSubmissionsV3 = async (req: Request, res: Response) => {
  const { campaignId, userId, status } = req.query;
  const currentUserId = req.session.userid;

  try {
    // Get user role
    const user = await prisma.user.findUnique({
      where: { id: currentUserId },
      select: { role: true }
    });

    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }

    const whereClause: any = {};

    if (campaignId) {
      whereClause.campaignId = campaignId as string;
    }

    if (userId) {
      whereClause.userId = userId as string;
    }

    if (status) {
      whereClause.status = status as string;
    }

    // Only get submissions for client-created campaigns
    const submissions = await prisma.submission.findMany({
      where: {
        ...whereClause,
        campaign: {
          origin: 'CLIENT'
        }
      },
      include: {
        campaign: true,
        user: true,
        submissionType: true,
        feedback: {
          orderBy: {
            createdAt: 'desc'
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    // Transform submissions to show role-based status
    const transformedSubmissions = submissions.map(submission => {
      let displayStatus = submission.status;
      
      // Role-based status display logic for V3 flow
      if (user.role === 'admin' || user.role === 'superadmin') {
        // Admin sees actual status: PENDING_REVIEW, SENT_TO_CLIENT, CLIENT_APPROVED
        displayStatus = submission.status;
      } else if (user.role === 'client') {
        // Client sees: 
        // - PENDING_REVIEW -> NOT_STARTED (admin hasn't approved yet)
        // - SENT_TO_CLIENT -> PENDING_REVIEW (admin approved, waiting for client)
        // - CLIENT_CHANGES_REQUESTED -> PENDING_REVIEW (client requested changes, waiting for admin)
        // - CLIENT_APPROVED -> APPROVED (client approved)
        // - APPROVED -> PENDING_REVIEW (for V3 campaigns, admin approved = waiting for client)
        if (submission.status === 'PENDING_REVIEW') {
          displayStatus = 'NOT_STARTED';
        } else if (submission.status === 'SENT_TO_CLIENT') {
          displayStatus = 'PENDING_REVIEW';
        } else if (submission.status === 'CLIENT_CHANGES_REQUESTED') {
          displayStatus = 'PENDING_REVIEW';
        } else if (submission.status === 'CLIENT_APPROVED') {
          displayStatus = 'APPROVED';
        } else if (submission.status === 'APPROVED') {
          // For V3 campaigns, APPROVED means admin approved and sent to client
          displayStatus = 'PENDING_REVIEW';
        } else {
          // Fallback for any unexpected status
          displayStatus = submission.status;
        }
      } else if (user.role === 'creator') {
        // Creator sees: 
        // - PENDING_REVIEW -> PENDING_REVIEW (waiting for admin)
        // - SENT_TO_CLIENT -> PENDING_REVIEW (waiting for client)
        // - CLIENT_CHANGES_REQUESTED -> PENDING_REVIEW (waiting for admin to review client feedback)
        // - CLIENT_APPROVED -> APPROVED (approved)
        if (submission.status === 'SENT_TO_CLIENT') {
          displayStatus = 'PENDING_REVIEW';
        } else if (submission.status === 'CLIENT_CHANGES_REQUESTED') {
          displayStatus = 'PENDING_REVIEW';
        } else if (submission.status === 'CLIENT_APPROVED') {
          displayStatus = 'APPROVED';
        }
      }

      const transformedSubmission = {
        ...submission,
        displayStatus // Add display status for frontend
      };

      return transformedSubmission;
    });

    return res.status(200).json(transformedSubmissions);

  } catch (error) {
    console.error('Error getting v3 submissions:', error);
    return res.status(500).json({ message: 'Failed to get submissions' });
  }
};

// Get single submission with role-based status display
export const getSubmissionByIdV3 = async (req: Request, res: Response) => {
  const { submissionId } = req.params;
  const currentUserId = req.session.userid;

  try {
    // Get user role
    const user = await prisma.user.findUnique({
      where: { id: currentUserId },
      select: { role: true }
    });

    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }

    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        campaign: true,
        user: true,
        submissionType: true,
        feedback: {
          orderBy: {
            createdAt: 'desc'
          }
        }
      }
    });

    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    // Check if this is a client-created campaign
    if (submission.campaign.origin !== 'CLIENT') {
      return res.status(400).json({ message: 'This endpoint is only for client-created campaigns' });
    }

    // Transform submission to show role-based status
    let displayStatus = submission.status;
    
    // Role-based status display logic for V3 flow
    if (user.role === 'admin' || user.role === 'superadmin') {
      // Admin sees actual status: PENDING_REVIEW, SENT_TO_CLIENT, CLIENT_APPROVED
      displayStatus = submission.status;
    } else if (user.role === 'client') {
      // Client sees: 
      // - PENDING_REVIEW -> NOT_STARTED (admin hasn't approved yet)
      // - SENT_TO_CLIENT -> PENDING_REVIEW (admin approved, waiting for client)
      // - CLIENT_CHANGES_REQUESTED -> PENDING_REVIEW (client requested changes, waiting for admin)
      // - CLIENT_APPROVED -> APPROVED (client approved)
      // - APPROVED -> PENDING_REVIEW (for V3 campaigns, admin approved = waiting for client)
      if (submission.status === 'PENDING_REVIEW') {
        displayStatus = 'NOT_STARTED';
      } else if (submission.status === 'SENT_TO_CLIENT') {
        displayStatus = 'PENDING_REVIEW';
      } else if (submission.status === 'CLIENT_CHANGES_REQUESTED') {
        displayStatus = 'PENDING_REVIEW';
      } else if (submission.status === 'CLIENT_APPROVED') {
        displayStatus = 'APPROVED';
      } else if (submission.status === 'APPROVED') {
        // For V3 campaigns, APPROVED means admin approved and sent to client
        displayStatus = 'PENDING_REVIEW';
      }
    } else if (user.role === 'creator') {
      // Creator sees: 
      // - PENDING_REVIEW -> PENDING_REVIEW (waiting for admin)
      // - SENT_TO_CLIENT -> PENDING_REVIEW (waiting for client)
      // - CLIENT_CHANGES_REQUESTED -> PENDING_REVIEW (waiting for admin to review client feedback)
      // - CLIENT_APPROVED -> APPROVED (approved)
      if (submission.status === 'SENT_TO_CLIENT') {
        displayStatus = 'PENDING_REVIEW';
      } else if (submission.status === 'CLIENT_CHANGES_REQUESTED') {
        displayStatus = 'PENDING_REVIEW';
      } else if (submission.status === 'CLIENT_APPROVED') {
        displayStatus = 'APPROVED';
      }
    }

    const transformedSubmission = {
      ...submission,
      displayStatus // Add display status for frontend
    };

    return res.status(200).json(transformedSubmission);

  } catch (error) {
    console.error('Error getting submission by ID:', error);
    return res.status(500).json({ message: 'Failed to get submission' });
  }
};

// V3: Creator submits draft (First Draft or Final Draft)
export const submitDraftV3 = async (req: Request, res: Response) => {
  const { submissionId, caption, photosDriveLink, rawFootagesDriveLink } = JSON.parse(req.body.data);
  const files = req.files as any;
  const userid = req.session.userid;

  // Handle multiple draft videos
  const draftVideos = Array.isArray(files?.draftVideo) ? files.draftVideo : files?.draftVideo ? [files.draftVideo] : [];
  const rawFootages = Array.isArray(files?.rawFootage) ? files.rawFootage : files?.rawFootage ? [files.rawFootage] : [];
  const photos = Array.isArray(files?.photos) ? files.photos : files?.photos ? [files.photos] : [];

  let amqp: amqplib.Connection | null = null;
  let channel: amqplib.Channel | null = null;

  try {
    amqp = await amqplib.connect(process.env.RABBIT_MQ!);
    channel = await amqp.createChannel();
    await channel.assertQueue('draft', { durable: true });

    // Move files to /tmp and build filePaths map
    const filePaths = new Map();

    if (draftVideos.length) {
      filePaths.set('video', []);
      for (const draftVideo of draftVideos) {
        const draftVideoPath = `/tmp/${submissionId}_${draftVideo.name}`;
        await draftVideo.mv(draftVideoPath);
        filePaths.get('video').push({
          inputPath: draftVideoPath,
          outputPath: `/tmp/${submissionId}_${draftVideo.name.replace('.mp4', '')}_compressed.mp4`,
          fileName: `${submissionId}_${draftVideo.name}`,
        });
      }
    }

    if (rawFootages.length) {
      filePaths.set('rawFootages', []);
      for (const rawFootage of rawFootages) {
        const rawFootagePath = `/tmp/${submissionId}_${rawFootage.name}`;
        await rawFootage.mv(rawFootagePath);
        filePaths.get('rawFootages').push(rawFootagePath);
      }
    }

    if (photos.length) {
      filePaths.set('photos', []);
      for (const photo of photos) {
        const photoPath = `/tmp/${submissionId}_${photo.name}`;
        await photo.mv(photoPath);
        filePaths.get('photos').push(photoPath);
      }
    }

    // Fetch submission for campaignId, folder, admins
    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        campaign: {
          include: { campaignAdmin: true },
        },
        submissionType: true,
      },
    });
    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    const messagePayload = {
      userid,
      submissionId,
      campaignId: submission.campaignId,
      folder: submission.submissionType.type,
      caption,
      admins: submission.campaign.campaignAdmin,
      filePaths: Object.fromEntries(filePaths),
    };

    channel.sendToQueue(
      'draft',
      Buffer.from(JSON.stringify(messagePayload)),
      { persistent: true },
    );

    activeProcesses.set(submissionId, { status: 'queue' });

    return res.status(200).json({ message: 'Video start processing' });
  } catch (error) {
    console.error('V3 Draft Upload - Error:', error);
    return res.status(400).json(error);
  } finally {
    if (channel) await channel.close();
    if (amqp) await amqp.close();
  }
};

// V3: Admin approves draft and sends to client
export const approveDraftByAdminV3 = async (req: Request, res: Response) => {
  const submissionId = req.body.submissionId || req.params.submissionId;
  const feedback = req.body.feedback;
  const adminId = req.session.userid;

  if (!submissionId) {
    console.error('V3 Admin Approval - No submissionId provided!');
    return res.status(400).json({ message: 'Submission ID is missing!' });
  }

  try {
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
                    user: true
                  }
                }
              }
            }
          }
        }
      }
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
        message: `Submission is not in correct status for admin approval. Current status: ${submission.status}` 
      });
    }

    // Update submission status to SENT_TO_CLIENT (not APPROVED for V3)
    await prisma.submission.update({
      where: { id: submissionId },
      data: {
        status: 'SENT_TO_CLIENT',
        approvedByAdminId: adminId,
        completedAt: new Date()
      }
    });

    // Add feedback if provided
    if (feedback) {
      await prisma.feedback.create({
        data: {
          content: feedback,
          type: 'COMMENT',
          adminId: adminId,
          submissionId: submissionId
        }
      });
    }

    // Create notification for client users
    const clientUsers = submission.campaign.campaignAdmin.filter(ca => 
      ca.admin.user.role === 'client'
    );

    for (const clientUser of clientUsers) {
      await prisma.notification.create({
        data: {
          title: 'Draft Sent to Client',
          message: `A ${submission.submissionType.type.toLowerCase().replace('_', ' ')} has been approved by admin and sent to you for review.`,
          entity: 'Draft',
          campaignId: submission.campaignId,
          userId: clientUser.admin.userId
        }
      });
    }

    return res.status(200).json({ message: 'Draft approved and sent to client for review' });

  } catch (error) {
    console.error('V3 Admin Approval - Error:', error);
    return res.status(500).json({ message: 'Failed to approve draft' });
  }
};

// V3: Admin requests changes for draft
export const requestChangesByAdminV3 = async (req: Request, res: Response) => {
  const { submissionId, feedback, reasons } = req.body;
  const adminId = req.session.userid;

  try {
    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        submissionType: true,
        user: true,
        campaign: true
      }
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
        message: `Submission is not in correct status for changes request. Current status: ${submission.status}` 
      });
    }

    // Update submission status to CHANGES_REQUIRED
    await prisma.submission.update({
      where: { id: submissionId },
      data: {
        status: 'CHANGES_REQUIRED',
        approvedByAdminId: adminId,
        completedAt: new Date()
      }
    });

    // Add feedback
    await prisma.feedback.create({
      data: {
        content: feedback,
        type: 'REASON',
        reasons: reasons,
        adminId: adminId,
        submissionId: submissionId
      }
    });

    // Create notification for creator
    await prisma.notification.create({
      data: {
        title: 'Changes Requested',
        message: `Changes have been requested for your ${submission.submissionType.type.toLowerCase().replace('_', ' ')} in campaign "${submission.campaign.name}".`,
        entity: 'Draft',
        campaignId: submission.campaignId,
        userId: submission.userId
      }
    });

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
                    user: true
                  }
                }
              }
            }
          }
        }
      }
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
        message: `Submission is not in correct status for client approval. Current status: ${submission.status}` 
      });
    }

    // Verify client has access to this campaign
    const clientAccess = submission.campaign.campaignAdmin.find(ca => 
      ca.admin.userId === clientId && ca.admin.user.role === 'client'
    );

    if (!clientAccess) {
      return res.status(403).json({ message: 'Client not authorized for this campaign' });
    }

    // Update submission status to CLIENT_APPROVED
    await prisma.submission.update({
      where: { id: submissionId },
      data: {
        status: 'CLIENT_APPROVED',
        completedAt: new Date()
      }
    });

    // Add feedback if provided
    if (feedback) {
      await prisma.feedback.create({
        data: {
          content: feedback,
          type: 'COMMENT',
          adminId: clientId,
          submissionId: submissionId
        }
      });
    }

    // Check if this is the final step (posting submission)
    if (submission.submissionType.type === 'POSTING') {
      // Generate invoice or mark campaign as completed
      console.log(`Posting approved by client - campaign ${submission.campaignId} completed`);
      // TODO: Add invoice generation logic here
    } else {
      // Activate next submission in the workflow
      let nextSubmissionType: any = 'POSTING'; // Default to posting
      
      if (submission.submissionType.type === 'FIRST_DRAFT') {
        // Skip Final Draft and go directly to Posting
        nextSubmissionType = 'POSTING';
      } else if (submission.submissionType.type === 'FINAL_DRAFT') {
        nextSubmissionType = 'POSTING';
      }

      const nextSubmission = await prisma.submission.findFirst({
        where: {
          userId: submission.userId,
          campaignId: submission.campaignId,
          submissionType: {
            type: nextSubmissionType
          }
        }
      });

      if (nextSubmission) {
        await prisma.submission.update({
          where: { id: nextSubmission.id },
          data: {
            status: 'IN_PROGRESS',
            nextsubmissionDate: new Date()
          }
        });

        // Create notification for creator
        await prisma.notification.create({
          data: {
            title: `${nextSubmissionType.replace('_', ' ')} Ready`,
            message: `Your ${submission.submissionType.type.toLowerCase().replace('_', ' ')} has been approved by client. You can now work on your ${nextSubmissionType.toLowerCase().replace('_', ' ')} for campaign "${submission.campaign.name}".`,
            entity: 'Draft',
            campaignId: submission.campaignId,
            userId: submission.userId
          }
        });
      }
    }

    // Create notification for admin and creator
    const adminUsers = submission.campaign.campaignAdmin.filter(ca => 
      ca.admin.user.role === 'admin' || ca.admin.user.role === 'superadmin'
    );

    for (const adminUser of adminUsers) {
      await prisma.notification.create({
        data: {
          title: 'Draft Approved by Client',
          message: `A ${submission.submissionType.type.toLowerCase().replace('_', ' ')} has been approved by client for campaign "${submission.campaign.name}".`,
          entity: 'Draft',
          campaignId: submission.campaignId,
          userId: adminUser.admin.userId
        }
      });
    }

    // Notify creator
    await prisma.notification.create({
      data: {
        title: 'Draft Approved',
        message: `Your ${submission.submissionType.type.toLowerCase().replace('_', ' ')} has been approved by client for campaign "${submission.campaign.name}".`,
        entity: 'Draft',
        campaignId: submission.campaignId,
        userId: submission.userId
      }
    });

    return res.status(200).json({ message: 'Draft approved by client' });

  } catch (error) {
    console.error('Error approving draft by client V3:', error);
    return res.status(500).json({ message: 'Failed to approve draft' });
  }
};

// V3: Client requests changes (changes from SENT_TO_CLIENT to CLIENT_CHANGES_REQUESTED)
export const requestChangesByClientV3 = async (req: Request, res: Response) => {
  const { submissionId, feedback, reasons } = req.body;
  const clientId = req.session.userid;

  try {
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
                    user: true
                  }
                }
              }
            }
          }
        }
      }
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
        message: `Submission is not in correct status for client feedback. Current status: ${submission.status}` 
      });
    }

    // Verify client has access to this campaign
    const clientAccess = submission.campaign.campaignAdmin.find(ca => 
      ca.admin.userId === clientId && ca.admin.user.role === 'client'
    );

    if (!clientAccess) {
      return res.status(403).json({ message: 'Client not authorized for this campaign' });
    }

    // Update submission status to CLIENT_CHANGES_REQUESTED
    await prisma.submission.update({
      where: { id: submissionId },
      data: {
        status: 'CLIENT_CHANGES_REQUESTED'
      }
    });

    // Add feedback
    await prisma.feedback.create({
      data: {
        content: feedback,
        type: 'REASON',
        reasons: reasons || [],
        adminId: clientId,
        submissionId: submissionId
      }
    });

    // Create notification for admin
    const adminUsers = submission.campaign.campaignAdmin.filter(ca => 
      ca.admin.user.role === 'admin' || ca.admin.user.role === 'superadmin'
    );

    for (const adminUser of adminUsers) {
      await prisma.notification.create({
        data: {
          title: 'Client Requested Changes',
          message: `Client has requested changes for ${submission.submissionType.type.toLowerCase().replace('_', ' ')} in campaign "${submission.campaign.name}".`,
          entity: 'Draft',
          campaignId: submission.campaignId,
          userId: adminUser.admin.userId
        }
      });
    }

    return res.status(200).json({ message: 'Changes requested by client' });

  } catch (error) {
    console.error('V3 Client Feedback - Error:', error);
    return res.status(500).json({ message: 'Failed to request changes' });
  }
};

// V3: Admin reviews client feedback and forwards to creator
export const forwardClientFeedbackV3 = async (req: Request, res: Response) => {
  const { submissionId, adminFeedback } = req.body;
  const adminId = req.session.userid;

  if (!submissionId) {
    console.error('V3 Posting Client Feedback Forward - No submissionId provided!');
    return res.status(400).json({ message: 'Submission ID is missing!' });
  }

  try {
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
                    user: true
                  }
                }
              }
            }
          }
        }
      }
    });

    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    // Check if this is a client-created campaign
    if (submission.campaign.origin !== 'CLIENT') {
      return res.status(400).json({ message: 'This endpoint is only for client-created campaigns' });
    }

    // Check if submission is a posting submission
    if (submission.submissionType.type !== 'POSTING') {
      return res.status(400).json({ message: 'This endpoint is only for posting submissions' });
    }

    // Check if submission is in correct status
    if (submission.status !== 'CLIENT_CHANGES_REQUESTED') {
      return res.status(400).json({ 
        message: `Submission is not in correct status for forwarding feedback. Current status: ${submission.status}` 
      });
    }

    // Update submission status to CHANGES_REQUIRED (back to creator)
    await prisma.submission.update({
      where: { id: submissionId },
      data: {
        status: 'CHANGES_REQUIRED'
      }
    });

    // Add admin's review of client feedback
    if (adminFeedback) {
      await prisma.feedback.create({
        data: {
          content: adminFeedback,
          type: 'COMMENT',
          adminId: adminId,
          submissionId: submissionId
        }
      });
    }

    // Create notification for creator
    await prisma.notification.create({
      data: {
        title: 'Changes Required',
        message: `Changes have been requested for your posting submission in campaign "${submission.campaign.name}". Please review the feedback and resubmit.`,
        entity: Entity.Post,
        campaignId: submission.campaignId,
        userId: submission.userId
      }
    });

    console.log(`Client posting feedback forwarded for submission ${submissionId}, status updated to CHANGES_REQUIRED`);
    return res.status(200).json({ message: 'Client feedback forwarded to creator' });

  } catch (error) {
    console.error('V3 Posting Client Feedback Forward - Error:', error);
    return res.status(500).json({ message: 'Failed to forward feedback' });
  }
}; 

// V3: Individual media approval (doesn't change overall submission status)
export const approveIndividualMediaV3 = async (req: Request, res: Response) => {
  const { mediaId, mediaType, feedback } = req.body;
  const adminId = req.session.userid;

  try {
    // Get the media item
    let mediaItem;
    if (mediaType === 'photo') {
      mediaItem = await prisma.photo.findUnique({
        where: { id: mediaId },
        include: {
          submission: {
            include: {
              campaign: true
            }
          }
        }
      });
    } else if (mediaType === 'video') {
      mediaItem = await prisma.video.findUnique({
        where: { id: mediaId },
        include: {
          submission: {
            include: {
              campaign: true
            }
          }
        }
      });
    } else if (mediaType === 'rawFootage') {
      mediaItem = await prisma.rawFootage.findUnique({
        where: { id: mediaId },
        include: {
          submission: {
            include: {
              campaign: true
            }
          }
        }
      });
    }

    if (!mediaItem) {
      return res.status(404).json({ message: 'Media item not found' });
    }

    // Check if this is a client-created campaign
    if (mediaItem.submission?.campaign.origin !== 'CLIENT') {
      return res.status(400).json({ message: 'This endpoint is only for client-created campaigns' });
    }

    const submissionId = mediaItem.submissionId;

    if (!submissionId) {
      return res.status(400).json({ message: 'Media item has no associated submission' });
    }

    // Update ONLY the media item status - don't change submission status
    if (mediaType === 'photo') {
      await prisma.photo.update({
        where: { id: mediaId },
        data: {
          status: 'SENT_TO_CLIENT',
          feedback: feedback || 'Approved by admin'
        }
      });
    } else if (mediaType === 'video') {
      await prisma.video.update({
        where: { id: mediaId },
        data: {
          status: 'SENT_TO_CLIENT',
          feedback: feedback || 'Approved by admin'
        }
      });
    } else if (mediaType === 'rawFootage') {
      await prisma.rawFootage.update({
        where: { id: mediaId },
        data: {
          status: 'SENT_TO_CLIENT',
          feedback: feedback || 'Approved by admin'
        }
      });
    }

    // Add feedback if provided
    if (feedback) {
      await prisma.feedback.create({
        data: {
          content: feedback,
          type: 'COMMENT',
          adminId: adminId,
          submissionId: submissionId
        }
      });
    }

    // Check if all media items are approved and update submission status if needed
    const allApproved = await checkAndUpdateSubmissionStatusV3(submissionId, adminId);

    return res.status(200).json({
      message: `${mediaType} approved successfully`,
      mediaStatus: 'APPROVED',
      allApproved,
      submissionStatus: allApproved ? 'SENT_TO_CLIENT' : 'PENDING_REVIEW'
    });

  } catch (error) {
    console.error('V3 Individual Media Approval - Error:', error);
    return res.status(500).json({ message: 'Failed to approve media item' });
  }
};

// V3: Individual media request changes (doesn't change overall submission status)
export const requestChangesIndividualMediaV3 = async (req: Request, res: Response) => {
  const { mediaId, mediaType, feedback, reasons } = req.body;
  const adminId = req.session.userid;

  try {
    // Get the media item
    let mediaItem;
    if (mediaType === 'photo') {
      mediaItem = await prisma.photo.findUnique({
        where: { id: mediaId },
        include: {
          submission: {
            include: {
              campaign: true
            }
          }
        }
      });
    } else if (mediaType === 'video') {
      mediaItem = await prisma.video.findUnique({
        where: { id: mediaId },
        include: {
          submission: {
            include: {
              campaign: true
            }
          }
        }
      });
    } else if (mediaType === 'rawFootage') {
      mediaItem = await prisma.rawFootage.findUnique({
        where: { id: mediaId },
        include: {
          submission: {
            include: {
              campaign: true
            }
          }
        }
      });
    }

    if (!mediaItem) {
      return res.status(404).json({ message: 'Media item not found' });
    }

    // Check if this is a client-created campaign
    if (mediaItem.submission?.campaign.origin !== 'CLIENT') {
      return res.status(400).json({ message: 'This endpoint is only for client-created campaigns' });
    }

    // Update the media item status
    if (mediaType === 'photo') {
      await prisma.photo.update({
        where: { id: mediaId },
        data: {
          status: 'CHANGES_REQUIRED' as any,
          feedback: feedback || 'Changes requested by admin',
          reasons: reasons || []
        }
      });
    } else if (mediaType === 'video') {
      await prisma.video.update({
        where: { id: mediaId },
        data: {
          status: 'CHANGES_REQUIRED' as any,
          feedback: feedback || 'Changes requested by admin',
          reasons: reasons || []
        }
      });
    } else if (mediaType === 'rawFootage') {
      await prisma.rawFootage.update({
        where: { id: mediaId },
        data: {
          status: 'CHANGES_REQUIRED' as any,
          feedback: feedback || 'Changes requested by admin',
          reasons: reasons || []
        }
      });
    }

    return res.status(200).json({ message: `Changes requested for ${mediaType}` });

  } catch (error) {
    console.error('V3 Individual Media Request Changes - Error:', error);
    return res.status(500).json({ message: 'Failed to request changes for media item' });
  }
};

// V3: Client approves submission (changes from SENT_TO_CLIENT to CLIENT_APPROVED)
export const approveSubmissionByClientV3 = async (req: Request, res: Response) => {
  const { submissionId, feedback } = req.body;
  const clientId = req.session.userid;

  try {
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
                    user: true
                  }
                }
              }
            }
          }
        }
      }
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
        message: `Submission is not in correct status for client approval. Current status: ${submission.status}` 
      });
    }

    // Verify client has access to this campaign
    const clientAccess = submission.campaign.campaignAdmin.find(ca => 
      ca.admin.userId === clientId && ca.admin.user.role === 'client'
    );

    if (!clientAccess) {
      return res.status(403).json({ message: 'Client not authorized for this campaign' });
    }

    // Update submission status to CLIENT_APPROVED
    await prisma.submission.update({
      where: { id: submissionId },
      data: {
        status: 'CLIENT_APPROVED',
        completedAt: new Date()
      }
    });

    // Add feedback if provided
    if (feedback) {
      await prisma.feedback.create({
        data: {
          content: feedback,
          type: 'COMMENT',
          adminId: clientId,
          submissionId: submissionId
        }
      });
    }

    // Check if this is the final step (posting submission)
    if (submission.submissionType.type === 'POSTING') {
      // Generate invoice or mark campaign as completed
      console.log(`Posting approved by client - campaign ${submission.campaignId} completed`);
      // TODO: Add invoice generation logic here
    } else {
      // Activate next submission in the workflow
      let nextSubmissionType: any = 'POSTING'; // Default to posting
      
      if (submission.submissionType.type === 'FIRST_DRAFT') {
        // Skip Final Draft and go directly to Posting
        nextSubmissionType = 'POSTING';
      } else if (submission.submissionType.type === 'FINAL_DRAFT') {
        nextSubmissionType = 'POSTING';
      }

      const nextSubmission = await prisma.submission.findFirst({
        where: {
          userId: submission.userId,
          campaignId: submission.campaignId,
          submissionType: {
            type: nextSubmissionType
          }
        }
      });

      if (nextSubmission) {
        await prisma.submission.update({
          where: { id: nextSubmission.id },
          data: {
            status: 'IN_PROGRESS',
            nextsubmissionDate: new Date()
          }
        });

        // Create notification for creator
        await prisma.notification.create({
          data: {
            title: `${nextSubmissionType.replace('_', ' ')} Ready`,
            message: `Your ${submission.submissionType.type.toLowerCase().replace('_', ' ')} has been approved by client. You can now work on your ${nextSubmissionType.toLowerCase().replace('_', ' ')} for campaign "${submission.campaign.name}".`,
            entity: 'Draft',
            campaignId: submission.campaignId,
            userId: submission.userId
          }
        });
      }
    }

    // Create notification for admin and creator
    const adminUsers = submission.campaign.campaignAdmin.filter(ca => 
      ca.admin.user.role === 'admin' || ca.admin.user.role === 'superadmin'
    );

    for (const adminUser of adminUsers) {
      await prisma.notification.create({
        data: {
          title: 'Submission Approved by Client',
          message: `A ${submission.submissionType.type.toLowerCase().replace('_', ' ')} has been approved by client for campaign "${submission.campaign.name}".`,
          entity: 'Draft',
          campaignId: submission.campaignId,
          userId: adminUser.admin.userId
        }
      });
    }

    // Notify creator
    await prisma.notification.create({
      data: {
        title: 'Submission Approved',
        message: `Your ${submission.submissionType.type.toLowerCase().replace('_', ' ')} has been approved by client for campaign "${submission.campaign.name}".`,
        entity: 'Draft',
        campaignId: submission.campaignId,
        userId: submission.userId
      }
    });

    return res.status(200).json({ message: 'Submission approved by client' });

  } catch (error) {
    console.error('V3 Client Approval - Error:', error);
    return res.status(500).json({ message: 'Failed to approve submission' });
  }
};

// V3: Check if all media items are approved and update submission status
export const checkAndUpdateSubmissionStatusV3 = async (submissionId: string, adminId: string) => {
  try {
    // Get all media items for this submission
    const allPhotos = await prisma.photo.findMany({
      where: { submissionId }
    });
    const allVideos = await prisma.video.findMany({
      where: { submissionId }
    });
    const allRawFootages = await prisma.rawFootage.findMany({
      where: { submissionId }
    });

    const allMediaItems = [...allPhotos, ...allVideos, ...allRawFootages];
    
    const allApproved = allMediaItems.length > 0 && allMediaItems.every(item => item.status === 'SENT_TO_CLIENT');

    // If all media items are approved, update submission status to SENT_TO_CLIENT
    if (allApproved) {
      const updatedSubmission = await prisma.submission.update({
        where: { id: submissionId },
        data: {
          status: 'SENT_TO_CLIENT',
          approvedByAdminId: adminId
        }
      });
      
      return true;
    } else {
      return false;
    }
  } catch (error) {
    console.error('V3 Check Submission Status - Error:', error);
    return false;
  }
}; 

// V3: Client requests changes for individual media item
export const requestChangesIndividualMediaByClientV3 = async (req: Request, res: Response) => {
  const { mediaId, mediaType, feedback, reasons } = req.body;
  const clientId = req.session.userid;

  try {
    // Get the media item
    let mediaItem;
    let submissionId;

    if (mediaType === 'video') {
      mediaItem = await prisma.video.findUnique({
        where: { id: mediaId },
        include: {
          submission: {
            include: {
              campaign: true
            }
          }
        }
      });
      submissionId = mediaItem?.submissionId;
    } else if (mediaType === 'photo') {
      mediaItem = await prisma.photo.findUnique({
        where: { id: mediaId },
        include: {
          submission: {
            include: {
              campaign: true
            }
          }
        }
      });
      submissionId = mediaItem?.submissionId;
    } else if (mediaType === 'rawFootage') {
      mediaItem = await prisma.rawFootage.findUnique({
        where: { id: mediaId },
        include: {
          submission: {
            include: {
              campaign: true
            }
          }
        }
      });
      submissionId = mediaItem?.submissionId;
    }

    if (!mediaItem) {
      return res.status(404).json({ message: 'Media item not found' });
    }

    // Check if this is a client-created campaign
    if (mediaItem.submission?.campaign.origin !== 'CLIENT') {
      return res.status(400).json({ message: 'This endpoint is only for client-created campaigns' });
    }

    // Verify client has access to this campaign
    const clientAccess = await prisma.campaignAdmin.findFirst({
      where: {
        campaignId: mediaItem.submission.campaignId,
        admin: {
          userId: clientId,
          user: {
            role: 'client'
          }
        }
      }
    });

    if (!clientAccess) {
      return res.status(403).json({ message: 'Client not authorized for this campaign' });
    }

    // Update media item status to REJECTED
    if (mediaType === 'video') {
      await prisma.video.update({
        where: { id: mediaId },
        data: { status: 'REJECTED' as any }
      });
    } else if (mediaType === 'photo') {
      await prisma.photo.update({
        where: { id: mediaId },
        data: { status: 'REJECTED' as any }
      });
    } else if (mediaType === 'rawFootage') {
      await prisma.rawFootage.update({
        where: { id: mediaId },
        data: { status: 'REJECTED' as any }
      });
    }

    // Add feedback if provided
    if (feedback && submissionId) {
      await prisma.feedback.create({
        data: {
          content: feedback,
          type: 'REASON',
          reasons: reasons,
          adminId: clientId,
          submissionId: submissionId
        }
      });
    }

    return res.status(200).json({ message: `Changes requested for ${mediaType}` });

  } catch (error) {
    console.error('Error requesting changes by client V3:', error);
    return res.status(500).json({ message: 'Failed to request changes' });
  }
};

// V3: Client approves individual media item
export const approveIndividualMediaByClientV3 = async (req: Request, res: Response) => {
  const { mediaId, mediaType, feedback } = req.body;
  const clientId = req.session.userid;

  try {
    // Get the media item
    let mediaItem;
    let submissionId;

    if (mediaType === 'video') {
      mediaItem = await prisma.video.findUnique({
        where: { id: mediaId },
        include: {
          submission: {
            include: {
              campaign: true
            }
          }
        }
      });
      submissionId = mediaItem?.submissionId;
    } else if (mediaType === 'photo') {
      mediaItem = await prisma.photo.findUnique({
        where: { id: mediaId },
        include: {
          submission: {
            include: {
              campaign: true
            }
          }
        }
      });
      submissionId = mediaItem?.submissionId;
    } else if (mediaType === 'rawFootage') {
      mediaItem = await prisma.rawFootage.findUnique({
        where: { id: mediaId },
        include: {
          submission: {
            include: {
              campaign: true
            }
          }
        }
      });
      submissionId = mediaItem?.submissionId;
    }

    if (!mediaItem) {
      return res.status(404).json({ message: 'Media item not found' });
    }

    // Check if this is a client-created campaign
    if (mediaItem.submission?.campaign.origin !== 'CLIENT') {
      return res.status(400).json({ message: 'This endpoint is only for client-created campaigns' });
    }

    // Verify client has access to this campaign
    const clientAccess = await prisma.campaignAdmin.findFirst({
      where: {
        campaignId: mediaItem.submission.campaignId,
        admin: {
          userId: clientId,
          user: {
            role: 'client'
          }
        }
      }
    });

    if (!clientAccess) {
      return res.status(403).json({ message: 'Client not authorized for this campaign' });
    }

    // Check if submissionId exists
    if (!submissionId) {
      return res.status(400).json({ message: 'Media item has no associated submission' });
    }

    // Update media item status to APPROVED
    if (mediaType === 'video') {
      await prisma.video.update({
        where: { id: mediaId },
        data: { status: 'APPROVED' as any }
      });
    } else if (mediaType === 'photo') {
      await prisma.photo.update({
        where: { id: mediaId },
        data: { status: 'APPROVED' as any }
      });
    } else if (mediaType === 'rawFootage') {
      await prisma.rawFootage.update({
        where: { id: mediaId },
        data: { status: 'APPROVED' as any }
      });
    }

    // Add feedback if provided
    if (feedback && submissionId) {
      await prisma.feedback.create({
        data: {
          content: feedback,
          type: 'COMMENT',
          adminId: clientId,
          submissionId: submissionId
        }
      });
    }

    // Check if all media items in this submission are now approved by client
    const allPhotos = await prisma.photo.findMany({
      where: { submissionId }
    });
    const allVideos = await prisma.video.findMany({
      where: { submissionId }
    });
    const allRawFootages = await prisma.rawFootage.findMany({
      where: { submissionId }
    });

    const allMediaItems = [...allPhotos, ...allVideos, ...allRawFootages];
    const allClientApproved = allMediaItems.length > 0 && allMediaItems.every(item => item.status === 'APPROVED');

    // If all media items are approved by client, update submission status to CLIENT_APPROVED
    if (allClientApproved) {
      await prisma.submission.update({
        where: { id: submissionId },
        data: {
          status: 'CLIENT_APPROVED'
        }
      });

      // Check if this is Final Draft or First Draft and activate next submission
      const currentSubmission = await prisma.submission.findUnique({
        where: { id: submissionId },
        include: {
          submissionType: true,
          campaign: true
        }
      });

      if (currentSubmission?.submissionType?.type === 'FINAL_DRAFT') {
        // Find the posting submission for this campaign and creator
        const postingSubmission = await prisma.submission.findFirst({
          where: {
            userId: currentSubmission.userId,
            campaignId: currentSubmission.campaignId,
            submissionType: {
              type: 'POSTING'
            }
          }
        });

        if (postingSubmission) {
          // Activate the posting submission
          await prisma.submission.update({
            where: { id: postingSubmission.id },
            data: {
              status: 'IN_PROGRESS',
              nextsubmissionDate: new Date()
            }
          });

          // Create notification for creator
          await prisma.notification.create({
            data: {
              title: 'Posting Ready',
              message: `Your Final Draft has been approved by client. You can now submit your posting links for campaign "${currentSubmission.campaign?.name}".`,
              entity: 'Draft',
              campaignId: currentSubmission.campaignId,
              userId: currentSubmission.userId
            }
          });
        }
      } else if (currentSubmission?.submissionType?.type === 'FIRST_DRAFT') {
        // Skip Final Draft and activate Posting directly
        const postingSubmission = await prisma.submission.findFirst({
          where: {
            userId: currentSubmission.userId,
            campaignId: currentSubmission.campaignId,
            submissionType: {
              type: 'POSTING'
            }
          }
        });

        if (postingSubmission) {
          // Activate the posting submission
          await prisma.submission.update({
            where: { id: postingSubmission.id },
            data: {
              status: 'IN_PROGRESS',
              nextsubmissionDate: new Date()
            }
          });

          // Create notification for creator
          await prisma.notification.create({
            data: {
              title: 'Posting Ready',
              message: `Your First Draft has been approved by client. You can now submit your posting links for campaign "${currentSubmission.campaign?.name}".`,
              entity: 'Draft',
              campaignId: currentSubmission.campaignId,
              userId: currentSubmission.userId
            }
          });
        }
      }
    }

    return res.status(200).json({ 
      message: `${mediaType} approved by client successfully`,
      allClientApproved,
      submissionStatus: allClientApproved ? 'CLIENT_APPROVED' : 'SENT_TO_CLIENT'
    });

  } catch (error) {
    console.error('Error approving media by client V3:', error);
    return res.status(500).json({ message: 'Failed to approve media item' });
  }
}; 

// V3: Admin approves posting and sends to client
export const approvePostingByAdminV3 = async (req: Request, res: Response) => {
  const submissionId = req.body.submissionId || req.params.submissionId;
  const feedback = req.body.feedback;
  const adminId = req.session.userid;

  if (!submissionId) {
    console.error('V3 Posting Admin Approval - No submissionId provided!');
    return res.status(400).json({ message: 'Submission ID is missing!' });
  }

  try {
    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        submissionType: true,
        user: {
          include: {
            creatorAgreement: true
          }
        },
        campaign: {
          include: {
            campaignAdmin: {
              include: {
                admin: {
                  include: {
                    user: true
                  }
                }
              }
            }
          }
        }
      }
    });

    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    // Check if this is a client-created campaign
    if (submission.campaign.origin !== 'CLIENT') {
      return res.status(400).json({ message: 'This endpoint is only for client-created campaigns' });
    }

    // Check if submission is a posting submission
    if (submission.submissionType.type !== 'POSTING') {
      return res.status(400).json({ message: 'This endpoint is only for posting submissions' });
    }

    // Check if submission is in correct status
    if (submission.status !== 'PENDING_REVIEW') {
      return res.status(400).json({ 
        message: `Submission is not in correct status for admin approval. Current status: ${submission.status}` 
      });
    }

    // Update submission status to SENT_TO_CLIENT (not APPROVED for V3)
    await prisma.submission.update({
      where: { id: submissionId },
      data: {
        status: 'SENT_TO_CLIENT',
        approvedByAdminId: adminId,
        completedAt: new Date()
      }
    });

    // Add feedback if provided
    if (feedback) {
      await prisma.feedback.create({
        data: {
          content: feedback,
          type: 'COMMENT',
          adminId: adminId,
          submissionId: submissionId
        }
      });
    }

    // Create notification for client users
    const clientUsers = submission.campaign.campaignAdmin.filter(ca => 
      ca.admin.user.role === 'client'
    );

    for (const clientUser of clientUsers) {
      await prisma.notification.create({
        data: {
          title: 'Posting Sent to Client',
          message: `A posting submission has been approved by admin and sent to you for review.`,
          entity: Entity.Post,
          campaignId: submission.campaignId,
          userId: clientUser.admin.userId
        }
      });
    }

    console.log(`Posting ${submissionId} approved by admin, status updated to SENT_TO_CLIENT`);
    return res.status(200).json({ message: 'Posting approved and sent to client for review' });

  } catch (error) {
    console.error('V3 Posting Admin Approval - Error:', error);
    return res.status(500).json({ message: 'Failed to approve posting' });
  }
};

// V3: Admin requests changes for posting
export const requestChangesForPostingByAdminV3 = async (req: Request, res: Response) => {
  const submissionId = req.body.submissionId || req.params.submissionId;
  const feedback = req.body.feedback;
  const reasons = req.body.reasons;
  const adminId = req.session.userid;

  if (!submissionId) {
    console.error('V3 Posting Changes Request - No submissionId provided!');
    return res.status(400).json({ message: 'Submission ID is missing!' });
  }

  try {
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
                    user: true
                  }
                }
              }
            }
          }
        }
      }
    });

    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    // Check if this is a client-created campaign
    if (submission.campaign.origin !== 'CLIENT') {
      return res.status(400).json({ message: 'This endpoint is only for client-created campaigns' });
    }

    // Check if submission is a posting submission
    if (submission.submissionType.type !== 'POSTING') {
      return res.status(400).json({ message: 'This endpoint is only for posting submissions' });
    }

    // Check if submission is in correct status
    if (submission.status !== 'PENDING_REVIEW') {
      return res.status(400).json({ 
        message: `Submission is not in correct status for changes request. Current status: ${submission.status}` 
      });
    }

    // Update submission status to CHANGES_REQUIRED
    await prisma.submission.update({
      where: { id: submissionId },
      data: {
        status: 'CHANGES_REQUIRED',
        approvedByAdminId: adminId,
        completedAt: new Date()
      }
    });

    // Add feedback
    await prisma.feedback.create({
      data: {
        content: feedback,
        type: 'REASON',
        reasons: reasons,
        adminId: adminId,
        submissionId: submissionId
      }
    });

    // Create notification for creator
    await prisma.notification.create({
      data: {
        title: 'Changes Requested',
        message: `Changes have been requested for your posting submission in campaign "${submission.campaign.name}".`,
        entity: Entity.Post,
        campaignId: submission.campaignId,
        userId: submission.userId
      }
    });

    console.log(`Changes requested for posting ${submissionId}, status updated to CHANGES_REQUIRED`);
    return res.status(200).json({ message: 'Changes requested successfully' });

  } catch (error) {
    console.error('V3 Posting Changes Request - Error:', error);
    return res.status(500).json({ message: 'Failed to request changes' });
  }
};

// V3: Client approves posting
export const approvePostingByClientV3 = async (req: Request, res: Response) => {
  const submissionId = req.body.submissionId || req.params.submissionId;
  const feedback = req.body.feedback;
  const clientId = req.session.userid;

  if (!submissionId) {
    console.error('V3 Posting Client Approval - No submissionId provided!');
    return res.status(400).json({ message: 'Submission ID is missing!' });
  }

  try {
    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        submissionType: true,
        user: {
          include: {
            creatorAgreement: true
          }
        },
        campaign: {
          include: {
            campaignAdmin: {
              include: {
                admin: {
                  include: {
                    user: true
                  }
                }
              }
            }
          }
        }
      }
    });

    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    // Check if this is a client-created campaign
    if (submission.campaign.origin !== 'CLIENT') {
      return res.status(400).json({ message: 'This endpoint is only for client-created campaigns' });
    }

    // Check if submission is a posting submission
    if (submission.submissionType.type !== 'POSTING') {
      return res.status(400).json({ message: 'This endpoint is only for posting submissions' });
    }

    // Check if submission is in correct status
    if (submission.status !== 'SENT_TO_CLIENT') {
      return res.status(400).json({ 
        message: `Submission is not in correct status for client approval. Current status: ${submission.status}` 
      });
    }

    // Verify client has access to this campaign
    const clientAccess = submission.campaign.campaignAdmin.find(ca => 
      ca.admin.userId === clientId && ca.admin.user.role === 'client'
    );

    if (!clientAccess) {
      return res.status(403).json({ message: 'Client not authorized for this campaign' });
    }

    // Update submission status to CLIENT_APPROVED
    await prisma.submission.update({
      where: { id: submissionId },
      data: {
        status: 'CLIENT_APPROVED',
        completedAt: new Date()
      }
    });

    // Add feedback if provided
    if (feedback) {
      await prisma.feedback.create({
        data: {
          content: feedback,
          type: 'COMMENT',
          adminId: clientId,
          submissionId: submissionId
        }
      });
    }

    // Generate invoice and mark campaign as completed
    const invoiceAmount = submission.user.creatorAgreement?.find(
      (elem) => elem.campaignId === submission.campaign.id,
    )?.amount;

    const invoiceItems = await getCreatorInvoiceLists(submissionId, prisma);

    await createInvoiceService(submission, clientId, invoiceAmount, invoiceItems, prisma);

    // Update shortlisted creator to mark campaign as done
    const shortlistedCreator = await prisma.shortListedCreator.findFirst({
      where: { userId: submission.userId, campaignId: submission.campaignId },
    });

    if (shortlistedCreator) {
      await prisma.shortListedCreator.update({
        where: { id: shortlistedCreator.id },
        data: { isCampaignDone: true },
      });
    }

    // Create notification for admin and creator
    const adminUsers = submission.campaign.campaignAdmin.filter(ca => 
      ca.admin.user.role === 'admin' || ca.admin.user.role === 'superadmin'
    );

    for (const adminUser of adminUsers) {
      await prisma.notification.create({
        data: {
          title: 'Posting Approved by Client',
          message: `A posting submission has been approved by client for campaign "${submission.campaign.name}".`,
          entity: Entity.Post,
          campaignId: submission.campaignId,
          userId: adminUser.admin.userId
        }
      });
    }

    // Notify creator
    await prisma.notification.create({
      data: {
        title: 'Posting Approved',
        message: `Your posting submission has been approved by client for campaign "${submission.campaign.name}".`,
        entity: Entity.Post,
        campaignId: submission.campaignId,
        userId: submission.userId
      }
    });

    console.log(`Posting ${submissionId} approved by client, status updated to CLIENT_APPROVED`);
    return res.status(200).json({ message: 'Posting approved by client' });

  } catch (error) {
    console.error('V3 Posting Client Approval - Error:', error);
    return res.status(500).json({ message: 'Failed to approve posting' });
  }
};

// V3: Client requests changes for posting
export const requestChangesForPostingByClientV3 = async (req: Request, res: Response) => {
  const submissionId = req.body.submissionId || req.params.submissionId;
  const feedback = req.body.feedback;
  const reasons = req.body.reasons;
  const clientId = req.session.userid;

  if (!submissionId) {
    console.error('V3 Posting Client Changes Request - No submissionId provided!');
    return res.status(400).json({ message: 'Submission ID is missing!' });
  }

  try {
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
                    user: true
                  }
                }
              }
            }
          }
        }
      }
    });

    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    // Check if this is a client-created campaign
    if (submission.campaign.origin !== 'CLIENT') {
      return res.status(400).json({ message: 'This endpoint is only for client-created campaigns' });
    }

    // Check if submission is a posting submission
    if (submission.submissionType.type !== 'POSTING') {
      return res.status(400).json({ message: 'This endpoint is only for posting submissions' });
    }

    // Check if submission is in correct status
    if (submission.status !== 'SENT_TO_CLIENT') {
      return res.status(400).json({ 
        message: `Submission is not in correct status for changes request. Current status: ${submission.status}` 
      });
    }

    // Verify client has access to this campaign
    const clientAccess = submission.campaign.campaignAdmin.find(ca => 
      ca.admin.userId === clientId && ca.admin.user.role === 'client'
    );

    if (!clientAccess) {
      return res.status(403).json({ message: 'Client not authorized for this campaign' });
    }

    // Update submission status to CLIENT_CHANGES_REQUESTED
    await prisma.submission.update({
      where: { id: submissionId },
      data: {
        status: 'CLIENT_CHANGES_REQUESTED',
        completedAt: new Date()
      }
    });

    // Add feedback
    await prisma.feedback.create({
      data: {
        content: feedback,
        type: 'REASON',
        reasons: reasons,
        adminId: clientId,
        submissionId: submissionId
      }
    });

    // Create notification for admin
    const adminUsers = submission.campaign.campaignAdmin.filter(ca => 
      ca.admin.user.role === 'admin' || ca.admin.user.role === 'superadmin'
    );

    for (const adminUser of adminUsers) {
      await prisma.notification.create({
        data: {
          title: 'Client Requested Changes',
          message: `Client has requested changes for posting submission in campaign "${submission.campaign.name}".`,
          entity: Entity.Post,
          campaignId: submission.campaignId,
          userId: adminUser.admin.userId
        }
      });
    }

    console.log(`Changes requested by client for posting ${submissionId}, status updated to CLIENT_CHANGES_REQUESTED`);
    return res.status(200).json({ message: 'Changes requested by client' });

  } catch (error) {
    console.error('V3 Posting Client Changes Request - Error:', error);
    return res.status(500).json({ message: 'Failed to request changes' });
  }
};

// V3: Admin reviews client feedback and forwards to creator
export const forwardClientPostingFeedbackV3 = async (req: Request, res: Response) => {
  const submissionId = req.body.submissionId || req.params.submissionId;
  const adminFeedback = req.body.adminFeedback;
  const adminId = req.session.userid;

  if (!submissionId) {
    console.error('V3 Posting Client Feedback Forward - No submissionId provided!');
    return res.status(400).json({ message: 'Submission ID is missing!' });
  }

  try {
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
                    user: true
                  }
                }
              }
            }
          }
        }
      }
    });

    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    // Check if this is a client-created campaign
    if (submission.campaign.origin !== 'CLIENT') {
      return res.status(400).json({ message: 'This endpoint is only for client-created campaigns' });
    }

    // Check if submission is a posting submission
    if (submission.submissionType.type !== 'POSTING') {
      return res.status(400).json({ message: 'This endpoint is only for posting submissions' });
    }

    // Check if submission is in correct status
    if (submission.status !== 'CLIENT_CHANGES_REQUESTED') {
      return res.status(400).json({ 
        message: `Submission is not in correct status for forwarding feedback. Current status: ${submission.status}` 
      });
    }

    // Update submission status to CHANGES_REQUIRED (back to creator)
    await prisma.submission.update({
      where: { id: submissionId },
      data: {
        status: 'CHANGES_REQUIRED'
      }
    });

    // Add admin's review of client feedback
    if (adminFeedback) {
      await prisma.feedback.create({
        data: {
          content: adminFeedback,
          type: 'COMMENT',
          adminId: adminId,
          submissionId: submissionId
        }
      });
    }

    // Create notification for creator
    await prisma.notification.create({
      data: {
        title: 'Changes Required',
        message: `Changes have been requested for your posting submission in campaign "${submission.campaign.name}". Please review the feedback and resubmit.`,
        entity: Entity.Post,
        campaignId: submission.campaignId,
        userId: submission.userId
      }
    });

    console.log(`Client posting feedback forwarded for submission ${submissionId}, status updated to CHANGES_REQUIRED`);
    return res.status(200).json({ message: 'Client feedback forwarded to creator' });

  } catch (error) {
    console.error('V3 Posting Client Feedback Forward - Error:', error);
    return res.status(500).json({ message: 'Failed to forward feedback' });
  }
}; 

 
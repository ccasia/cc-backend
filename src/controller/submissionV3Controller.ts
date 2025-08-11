import { Request, Response } from 'express';
import { PrismaClient, Entity } from '@prisma/client';
import amqplib from 'amqplib';
import fs from 'fs';
import path from 'path';
import { activeProcesses } from '../server';
import { getCreatorInvoiceLists } from '../service/submissionService';
import { createInvoiceService } from '../service/invoiceService';
import { creatorInvoice } from '../config/nodemailer.config';
import { notificationInvoiceGenerate } from '../helper/notification';
import { saveNotification } from './notificationController';

const prisma = new PrismaClient();

// V3: Get submissions with role-based status display
export const getSubmissionsV3 = async (req: Request, res: Response) => {
  const { campaignId, userId, status } = req.query;
  const currentUserId = req.session.userid;

  try {
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
        },
        user: true,
        submissionType: true,
        feedback: {
          include: {
            admin: true
          },
          orderBy: {
            createdAt: 'desc'
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    const transformedSubmissions = submissions.map(submission => {
      let displayStatus: string = submission.status;
      
      // Role-based status display logic
      if (user.role === 'admin' || user.role === 'superadmin') {
        if (submission.status === 'SENT_TO_ADMIN') {
          displayStatus = 'CLIENT_FEEDBACK';
        } else {
          displayStatus = submission.status;
        }
      } else if (user.role === 'client') {
        if (submission.status === 'PENDING_REVIEW') {
          displayStatus = 'NOT_STARTED';
        } else if (submission.status === 'SENT_TO_CLIENT') {
          displayStatus = 'PENDING_REVIEW';
        } else if (submission.status === 'SENT_TO_ADMIN') {
          displayStatus = 'CLIENT_FEEDBACK';
        } else if (submission.status === 'CLIENT_APPROVED') {
          displayStatus = 'APPROVED';
        } else if (submission.status === 'APPROVED') {
          // Special handling for posting submissions: don't transform APPROVED status
          if (submission.submissionType?.type === 'POSTING') {
            displayStatus = 'APPROVED'; // Keep as APPROVED for posting
            console.log(`🔍 Backend: Posting submission ${submission.id} - keeping APPROVED status for client`);
          } else {
            displayStatus = 'PENDING_REVIEW'; // Transform for other submission types
            console.log(`🔍 Backend: Non-posting submission ${submission.id} - transforming APPROVED to PENDING_REVIEW for client`);
          }
        } else {
          displayStatus = submission.status;
        }
        
        // Debug logging for client status transformations
        if (submission.submissionType?.type === 'POSTING') {
          console.log(`🔍 Backend: Client status transformation for posting submission:`, {
            submissionId: submission.id,
            originalStatus: submission.status,
            displayStatus,
            submissionType: submission.submissionType.type,
            userRole: user.role
          });
        }
      } else if (user.role === 'creator') {
        // For creators, show 'IN_REVIEW' when admin sends to client or when client feedback is being reviewed
        if (submission.status === 'SENT_TO_CLIENT' || submission.status === 'SENT_TO_ADMIN') {
          displayStatus = 'IN_REVIEW';
        } else if (submission.status === 'CLIENT_APPROVED') {
          displayStatus = 'APPROVED';
        } else if (submission.status === 'CHANGES_REQUIRED') {
          displayStatus = 'CHANGES_REQUIRED';
        } else if (submission.status === 'IN_PROGRESS') {
          displayStatus = 'IN_PROGRESS';
        }
      }

      return {
        ...submission,
        displayStatus
      };
    });

    return res.status(200).json(transformedSubmissions);

  } catch (error) {
    console.error('Error getting V3 submissions:', error);
    return res.status(500).json({ message: 'Failed to get submissions' });
  }
};

// V3: Get single submission with role-based status display
export const getSubmissionByIdV3 = async (req: Request, res: Response) => {
  const { submissionId } = req.params;
  const currentUserId = req.session.userid;

  try {
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
        },
        user: true,
        submissionType: true,
        feedback: {
          include: {
            admin: true
          },
          orderBy: {
            createdAt: 'desc'
          }
        },
        video: {
          include: {
            user: true
          }
        },
        photos: {
          include: {
            user: true
          }
        },
        rawFootages: {
          include: {
            user: true
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

    let displayStatus: string = submission.status;
    
    // Role-based status display logic
    if (user.role === 'admin' || user.role === 'superadmin') {
      if (submission.status === 'SENT_TO_ADMIN') {
        displayStatus = 'CLIENT_FEEDBACK';
      } else {
        displayStatus = submission.status;
      }
    } else if (user.role === 'client') {
      if (submission.status === 'PENDING_REVIEW') {
        displayStatus = 'NOT_STARTED';
      } else if (submission.status === 'SENT_TO_CLIENT') {
        displayStatus = 'PENDING_REVIEW';
      } else if (submission.status === 'SENT_TO_ADMIN') {
        displayStatus = 'CLIENT_FEEDBACK';
      } else if (submission.status === 'CLIENT_APPROVED') {
        displayStatus = 'APPROVED';
      } else if (submission.status === 'APPROVED') {
        // Special handling for posting submissions: don't transform APPROVED status
        if (submission.submissionType?.type === 'POSTING') {
          displayStatus = 'APPROVED'; // Keep as APPROVED for posting
        } else {
          displayStatus = 'PENDING_REVIEW'; // Transform for other submission types
        }
      } else {
        displayStatus = submission.status;
      }
    } else if (user.role === 'creator') {
      // For creators, show 'IN_REVIEW' when admin sends to client or when client feedback is being reviewed
      if (submission.status === 'SENT_TO_CLIENT' || submission.status === 'SENT_TO_ADMIN') {
        displayStatus = 'IN_REVIEW';
      } else if (submission.status === 'CLIENT_APPROVED') {
        displayStatus = 'APPROVED';
      }
    }

    const transformedSubmission = {
      ...submission,
      displayStatus 
    };

    return res.status(200).json(transformedSubmission);

  } catch (error) {
    console.error('Error getting V3 submission by ID:', error);
    return res.status(500).json({ message: 'Failed to get submission' });
  }
};

// V3: Approve individual media (admin sends to client)
export const approveIndividualMediaV3 = async (req: Request, res: Response) => {
  const { mediaId, mediaType, feedback } = req.body;
  const adminId = req.session.userid;

  try {
    console.log(`V3 Admin ${adminId} approving ${mediaType} ${mediaId}`);

    // Get the submission to check campaign origin
    let submission;
    switch (mediaType) {
      case 'video':
        submission = await prisma.submission.findFirst({
          where: {
            video: {
              some: {
                id: mediaId
              }
            }
          },
          include: {
            campaign: true
          }
        });
        break;
      case 'photo':
        submission = await prisma.submission.findFirst({
          where: {
            photos: {
              some: {
                id: mediaId
              }
            }
          },
          include: {
            campaign: true
          }
        });
        break;
      case 'rawFootage':
        submission = await prisma.submission.findFirst({
          where: {
            rawFootages: {
              some: {
                id: mediaId
              }
            }
          },
          include: {
            campaign: true
          }
        });
        break;
      default:
        return res.status(400).json({ message: 'Invalid media type' });
    }

    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    // Check if this is a client-created campaign
    if (submission.campaign.origin !== 'CLIENT') {
      return res.status(400).json({ message: 'This endpoint is only for client-created campaigns' });
    }

    // Update media status to SENT_TO_CLIENT (admin approval)
    let updatedMedia;
    switch (mediaType) {
      case 'video':
        updatedMedia = await prisma.video.update({
          where: { id: mediaId },
          data: { status: 'SENT_TO_CLIENT' }
        });
        break;
      case 'photo':
        updatedMedia = await prisma.photo.update({
          where: { id: mediaId },
          data: { status: 'SENT_TO_CLIENT' }
        });
        break;
      case 'rawFootage':
        updatedMedia = await prisma.rawFootage.update({
          where: { id: mediaId },
          data: { status: 'SENT_TO_CLIENT' }
        });
        break;
      default:
        return res.status(400).json({ message: 'Invalid media type' });
    }

    // Create feedback if provided
    if (feedback) {
      const feedbackData: any = {
        content: feedback,
        type: 'COMMENT',
        adminId: adminId,
        submissionId: submission.id,
      };

      // Add the correct field based on media type
      switch (mediaType) {
        case 'video':
          feedbackData.videosToUpdate = [mediaId];
          break;
        case 'photo':
          feedbackData.photosToUpdate = [mediaId];
          break;
        case 'rawFootage':
          feedbackData.rawFootageToUpdate = [mediaId];
          break;
      }

      await prisma.feedback.create({
        data: feedbackData
      });
    }

    // Check and update submission status
    await checkAndUpdateSubmissionStatusV3(submission.id, adminId);

    // Get updated submission status for logging
    const updatedSubmission = await prisma.submission.findUnique({
      where: { id: submission.id },
      select: { status: true }
    });

    console.log(`V3 ${mediaType} ${mediaId} approved by admin, individual media status: SENT_TO_CLIENT, submission status: ${updatedSubmission?.status}`);
    return res.status(200).json({ message: `${mediaType} approved and sent to client` });

  } catch (error) {
    console.error('Error approving individual media V3:', error);
    return res.status(500).json({ message: 'Failed to approve media' });
  }
};

// V3: Request changes for individual media
export const requestChangesIndividualMediaV3 = async (req: Request, res: Response) => {
  const { mediaId, mediaType, feedback, reasons } = req.body;
  const adminId = req.session.userid;

  try {
    console.log(`V3 Admin ${adminId} requesting changes for ${mediaType} ${mediaId}`);

    // Get the submission to check campaign origin
    let submission;
    switch (mediaType) {
      case 'video':
        submission = await prisma.submission.findFirst({
          where: {
            video: {
              some: {
                id: mediaId
              }
            }
          },
          include: {
            campaign: true
          }
        });
        break;
      case 'photo':
        submission = await prisma.submission.findFirst({
          where: {
            photos: {
              some: {
                id: mediaId
              }
            }
          },
          include: {
            campaign: true
          }
        });
        break;
      case 'rawFootage':
        submission = await prisma.submission.findFirst({
          where: {
            rawFootages: {
              some: {
                id: mediaId
              }
            }
          },
          include: {
            campaign: true
          }
        });
        break;
      default:
        return res.status(400).json({ message: 'Invalid media type' });
    }

    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    // Check if this is a client-created campaign
    if (submission.campaign.origin !== 'CLIENT') {
      return res.status(400).json({ message: 'This endpoint is only for client-created campaigns' });
    }

    // Update media status to REVISION_REQUESTED
    let updatedMedia;
    switch (mediaType) {
      case 'video':
        updatedMedia = await prisma.video.update({
          where: { id: mediaId },
          data: { status: 'REVISION_REQUESTED' }
        });
        break;
      case 'photo':
        updatedMedia = await prisma.photo.update({
          where: { id: mediaId },
          data: { status: 'REVISION_REQUESTED' }
        });
        break;
      case 'rawFootage':
        updatedMedia = await prisma.rawFootage.update({
          where: { id: mediaId },
          data: { status: 'REVISION_REQUESTED' }
        });
        break;
      default:
        return res.status(400).json({ message: 'Invalid media type' });
    }

    // Create feedback
    const feedbackData: any = {
      content: feedback,
      type: 'REASON',
      reasons: reasons,
      adminId: adminId,
      submissionId: submission.id,
    };

    // Add the correct field based on media type
    switch (mediaType) {
      case 'video':
        feedbackData.videosToUpdate = [mediaId];
        break;
      case 'photo':
        feedbackData.photosToUpdate = [mediaId];
        break;
      case 'rawFootage':
        feedbackData.rawFootageToUpdate = [mediaId];
        break;
    }

    await prisma.feedback.create({
      data: feedbackData
    });

    // Check and update submission status
    console.log(`V3 ${mediaType} ${mediaId} changes requested by admin - calling checkAndUpdateSubmissionStatusV3 for submission ${submission.id}`);
    await checkAndUpdateSubmissionStatusV3(submission.id, adminId);

    // Get updated submission status for logging
    const updatedSubmission = await prisma.submission.findUnique({
      where: { id: submission.id },
      select: { status: true }
    });

    console.log(`V3 ${mediaType} ${mediaId} changes requested by admin - individual media status: REVISION_REQUESTED, submission status: ${updatedSubmission?.status}`);
    return res.status(200).json({ message: 'Changes requested successfully' });

  } catch (error) {
    console.error('Error requesting changes for individual media V3:', error);
    return res.status(500).json({ message: 'Failed to request changes' });
  }
};

// V3: Client approves individual media
export const approveIndividualMediaByClientV3 = async (req: Request, res: Response) => {
  const { mediaId, mediaType, feedback } = req.body;
  const clientId = req.session.userid;

  try {
    console.log(`V3 Client ${clientId} approving ${mediaType} ${mediaId}`);

    // Get the submission to check campaign origin and client access
    let submission;
    switch (mediaType) {
      case 'video':
        submission = await prisma.submission.findFirst({
          where: {
            video: {
              some: {
                id: mediaId
              }
            }
          },
          include: {
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
        break;
      case 'photo':
        submission = await prisma.submission.findFirst({
          where: {
            photos: {
              some: {
                id: mediaId
              }
            }
          },
          include: {
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
        break;
      case 'rawFootage':
        submission = await prisma.submission.findFirst({
          where: {
            rawFootages: {
              some: {
                id: mediaId
              }
            }
          },
          include: {
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
        break;
      default:
        return res.status(400).json({ message: 'Invalid media type' });
    }

    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    // Check if this is a client-created campaign
    if (submission.campaign.origin !== 'CLIENT') {
      return res.status(400).json({ message: 'This endpoint is only for client-created campaigns' });
    }

    // Verify client has access to this campaign
    const clientAccess = submission.campaign.campaignAdmin.find(ca => 
      ca.admin.userId === clientId && ca.admin.user.role === 'client'
    );

    if (!clientAccess) {
      return res.status(403).json({ message: 'Client not authorized for this campaign' });
    }

    // Update media status to APPROVED (client approval)
    let updatedMedia;
    switch (mediaType) {
      case 'video':
        updatedMedia = await prisma.video.update({
        where: { id: mediaId },
          data: { status: 'APPROVED' }
        });
        break;
      case 'photo':
        updatedMedia = await prisma.photo.update({
        where: { id: mediaId },
          data: { status: 'APPROVED' }
        });
        break;
      case 'rawFootage':
        updatedMedia = await prisma.rawFootage.update({
        where: { id: mediaId },
          data: { status: 'APPROVED' }
        });
        break;
      default:
        return res.status(400).json({ message: 'Invalid media type' });
    }

    // Create feedback if provided
    if (feedback) {
      const feedbackData: any = {
        content: feedback,
        type: 'COMMENT',
        adminId: clientId,
        submissionId: submission.id,
      };

      // Add the correct field based on media type
      switch (mediaType) {
        case 'video':
          feedbackData.videosToUpdate = [mediaId];
          break;
        case 'photo':
          feedbackData.photosToUpdate = [mediaId];
          break;
        case 'rawFootage':
          feedbackData.rawFootageToUpdate = [mediaId];
          break;
      }

      await prisma.feedback.create({
        data: feedbackData
      });
    }

    // Check and update submission status
    await checkAndUpdateSubmissionStatusV3(submission.id, clientId);

    console.log(`V3 ${mediaType} ${mediaId} approved by client`);
    return res.status(200).json({ message: `${mediaType} approved by client` });

  } catch (error) {
    console.error('Error approving individual media by client V3:', error);
    return res.status(500).json({ message: 'Failed to approve media' });
  }
};

// V3: Client requests changes for individual media
export const requestChangesIndividualMediaByClientV3 = async (req: Request, res: Response) => {
  const { mediaId, mediaType, feedback, reasons } = req.body;
  const clientId = req.session.userid;

  try {
    console.log(`V3 Client ${clientId} requesting changes for ${mediaType} ${mediaId}`);

    // Get the submission to check campaign origin and client access
    let submission;
    switch (mediaType) {
      case 'video':
        submission = await prisma.submission.findFirst({
          where: {
            video: {
              some: {
                id: mediaId
              }
            }
          },
          include: {
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
        break;
      case 'photo':
        submission = await prisma.submission.findFirst({
          where: {
            photos: {
              some: {
                id: mediaId
              }
            }
          },
          include: {
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
        break;
      case 'rawFootage':
        submission = await prisma.submission.findFirst({
          where: {
            rawFootages: {
              some: {
                id: mediaId
              }
            }
          },
          include: {
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
        break;
      default:
        return res.status(400).json({ message: 'Invalid media type' });
    }

    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    // Check if this is a client-created campaign
    if (submission.campaign.origin !== 'CLIENT') {
      return res.status(400).json({ message: 'This endpoint is only for client-created campaigns' });
    }

    // Verify client has access to this campaign
    const clientAccess = submission.campaign.campaignAdmin.find(ca => 
      ca.admin.userId === clientId && ca.admin.user.role === 'client'
    );

    if (!clientAccess) {
      return res.status(403).json({ message: 'Client not authorized for this campaign' });
    }

    // Update media status to REVISION_REQUESTED (client requests changes)
    let updatedMedia;
    switch (mediaType) {
      case 'video':
        updatedMedia = await prisma.video.update({
          where: { id: mediaId },
          data: { status: 'REVISION_REQUESTED' }
        });
        break;
      case 'photo':
        updatedMedia = await prisma.photo.update({
          where: { id: mediaId },
          data: { status: 'REVISION_REQUESTED' }
        });
        break;
      case 'rawFootage':
        updatedMedia = await prisma.rawFootage.update({
          where: { id: mediaId },
          data: { status: 'REVISION_REQUESTED' }
        });
        break;
      default:
        return res.status(400).json({ message: 'Invalid media type' });
    }

    // Create feedback
    const feedbackData: any = {
      content: feedback,
      type: 'REASON',
      reasons: reasons,
      adminId: clientId,
      submissionId: submission.id,
    };

    // Add the correct field based on media type
    switch (mediaType) {
      case 'video':
        feedbackData.videosToUpdate = [mediaId];
        break;
      case 'photo':
        feedbackData.photosToUpdate = [mediaId];
        break;
      case 'rawFootage':
        feedbackData.rawFootageToUpdate = [mediaId];
        break;
    }

    await prisma.feedback.create({
      data: feedbackData
    });

    // Check and update submission status
    await checkAndUpdateSubmissionStatusV3(submission.id, clientId);

    console.log(`V3 ${mediaType} ${mediaId} changes requested by client`);
    return res.status(200).json({ message: 'Changes requested by client' });

  } catch (error) {
    console.error('Error requesting changes for individual media by client V3:', error);
    return res.status(500).json({ message: 'Failed to request changes' });
  }
};

// V3: Check and update submission status based on media statuses
export const checkAndUpdateSubmissionStatusV3 = async (submissionId: string, adminId: string) => {
  try {
    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        video: true,
        photos: true,
        rawFootages: true,
        campaign: true,
        submissionType: true
      }
    });

    if (!submission) {
      console.error('Submission not found for status update');
      return;
    }

    // Get campaign requirements
    const campaignRequiresVideos = true; // Always required
    const campaignRequiresPhotos = submission.campaign.photos;
    const campaignRequiresRawFootage = submission.campaign.rawFootage;

    // Count uploaded media items
    let uploadedVideos = submission.video.length;
    let uploadedPhotos = submission.photos.length;
    let uploadedRawFootages = submission.rawFootages.length;

    // For Final Draft, also count approved media from First Draft
    if (submission.submissionType.type === 'FINAL_DRAFT') {
      const firstDraftSubmission = await prisma.submission.findFirst({
        where: {
          userId: submission.userId,
          campaignId: submission.campaignId,
          submissionType: { type: 'FIRST_DRAFT' }
        },
        include: {
          video: true,
          photos: true,
          rawFootages: true,
        }
      });

      if (firstDraftSubmission) {
        // Count approved media from First Draft
        const approvedFirstDraftVideos = firstDraftSubmission.video.filter(v => v.status === 'APPROVED' || v.status === 'SENT_TO_CLIENT').length;
        const approvedFirstDraftPhotos = firstDraftSubmission.photos.filter(p => p.status === 'APPROVED' || p.status === 'SENT_TO_CLIENT').length;
        const approvedFirstDraftRawFootages = firstDraftSubmission.rawFootages.filter(r => r.status === 'APPROVED' || r.status === 'SENT_TO_CLIENT').length;

        // Add approved First Draft media to Final Draft counts
        uploadedVideos += approvedFirstDraftVideos;
        uploadedPhotos += approvedFirstDraftPhotos;
        uploadedRawFootages += approvedFirstDraftRawFootages;

        console.log(`V3 Final Draft media counts - First Draft approved: videos=${approvedFirstDraftVideos}, photos=${approvedFirstDraftPhotos}, rawFootages=${approvedFirstDraftRawFootages}`);
      }
    }

    // Count approved media items (client approved)
    let approvedVideos = submission.video.filter(v => v.status === 'APPROVED').length;
    let approvedPhotos = submission.photos.filter(p => p.status === 'APPROVED').length;
    let approvedRawFootages = submission.rawFootages.filter(r => r.status === 'APPROVED').length;

    // For Final Draft, also count approved media from First Draft
    if (submission.submissionType.type === 'FINAL_DRAFT') {
      const firstDraftSubmission = await prisma.submission.findFirst({
        where: {
          userId: submission.userId,
          campaignId: submission.campaignId,
          submissionType: { type: 'FIRST_DRAFT' }
        },
        include: {
          video: true,
          photos: true,
          rawFootages: true,
        }
      });

      if (firstDraftSubmission) {
        // Count approved media from First Draft
        const approvedFirstDraftVideos = firstDraftSubmission.video.filter(v => v.status === 'APPROVED').length;
        const approvedFirstDraftPhotos = firstDraftSubmission.photos.filter(p => p.status === 'APPROVED').length;
        const approvedFirstDraftRawFootages = firstDraftSubmission.rawFootages.filter(r => r.status === 'APPROVED').length;

        // Add approved First Draft media to Final Draft counts
        approvedVideos += approvedFirstDraftVideos;
        approvedPhotos += approvedFirstDraftPhotos;
        approvedRawFootages += approvedFirstDraftRawFootages;
      }
    }

    // Count media sent to client (admin approved)
    let sentToClientVideos = submission.video.filter(v => v.status === 'SENT_TO_CLIENT').length;
    let sentToClientPhotos = submission.photos.filter(p => p.status === 'SENT_TO_CLIENT').length;
    let sentToClientRawFootages = submission.rawFootages.filter(r => r.status === 'SENT_TO_CLIENT').length;

    // For Final Draft, also count media sent to client from First Draft
    if (submission.submissionType.type === 'FINAL_DRAFT') {
      const firstDraftSubmission = await prisma.submission.findFirst({
        where: {
          userId: submission.userId,
          campaignId: submission.campaignId,
          submissionType: { type: 'FIRST_DRAFT' }
        },
        include: {
          video: true,
          photos: true,
          rawFootages: true,
        }
      });

      if (firstDraftSubmission) {
        // Count media sent to client from First Draft
        const sentToClientFirstDraftVideos = firstDraftSubmission.video.filter(v => v.status === 'SENT_TO_CLIENT').length;
        const sentToClientFirstDraftPhotos = firstDraftSubmission.photos.filter(p => p.status === 'SENT_TO_CLIENT').length;
        const sentToClientFirstDraftRawFootages = firstDraftSubmission.rawFootages.filter(r => r.status === 'SENT_TO_CLIENT').length;

        // Add First Draft media sent to client to Final Draft counts
        sentToClientVideos += sentToClientFirstDraftVideos;
        sentToClientPhotos += sentToClientFirstDraftPhotos;
        sentToClientRawFootages += sentToClientFirstDraftRawFootages;
      }
    }

    // Count media with changes requested
    const changesRequestedVideos = submission.video.filter(v => v.status === 'REVISION_REQUESTED').length;
    const changesRequestedPhotos = submission.photos.filter(p => p.status === 'REVISION_REQUESTED').length;
    const changesRequestedRawFootages = submission.rawFootages.filter(r => r.status === 'REVISION_REQUESTED').length;

    // Check if all required media types have been uploaded
    const hasRequiredVideos = uploadedVideos > 0;
    const hasRequiredPhotos = !campaignRequiresPhotos || uploadedPhotos > 0;
    const hasRequiredRawFootage = !campaignRequiresRawFootage || uploadedRawFootages > 0;
    const allRequiredMediaUploaded = hasRequiredVideos && hasRequiredPhotos && hasRequiredRawFootage;

    // Check if all uploaded media has been reviewed (either approved by admin or changes requested)
    const allMediaReviewed = 
      (uploadedVideos === 0 || sentToClientVideos + changesRequestedVideos === uploadedVideos) &&
      (uploadedPhotos === 0 || sentToClientPhotos + changesRequestedPhotos === uploadedPhotos) &&
      (uploadedRawFootages === 0 || sentToClientRawFootages + changesRequestedRawFootages === uploadedRawFootages);

    // Check if all required media types are approved by client
    const allClientApproved = 
      (campaignRequiresVideos ? approvedVideos >= uploadedVideos : true) &&
      (campaignRequiresPhotos ? approvedPhotos >= uploadedPhotos : true) &&
      (campaignRequiresRawFootage ? approvedRawFootages >= uploadedRawFootages : true) &&
      // Additional check: no media items should have REVISION_REQUESTED status
      changesRequestedVideos === 0 &&
      changesRequestedPhotos === 0 &&
      changesRequestedRawFootages === 0;

    // Check if all media items have been processed (either approved or changes requested)
    const allMediaProcessed = 
      (uploadedVideos === 0 || approvedVideos + changesRequestedVideos === uploadedVideos) &&
      (uploadedPhotos === 0 || approvedPhotos + changesRequestedPhotos === uploadedPhotos) &&
      (uploadedRawFootages === 0 || approvedRawFootages + changesRequestedRawFootages === uploadedRawFootages);

    console.log(`V3 Status Check - Submission ${submissionId}:`, {
      campaignRequiresVideos,
      campaignRequiresPhotos,
      campaignRequiresRawFootage,
      uploadedVideos,
      uploadedPhotos,
      uploadedRawFootages,
      approvedVideos,
      approvedPhotos,
      approvedRawFootages,
      sentToClientVideos,
      sentToClientPhotos,
      sentToClientRawFootages,
      changesRequestedVideos,
      changesRequestedPhotos,
      changesRequestedRawFootages,
      allRequiredMediaUploaded,
      allMediaReviewed,
      allClientApproved,
      allMediaProcessed,
      currentStatus: submission.status
    });

    // Update submission status based on conditions
    const hasChangesRequested = (changesRequestedVideos > 0) || (changesRequestedPhotos > 0) || (changesRequestedRawFootages > 0);

    // For Final Draft: if client requests changes and all media is processed, set status to SENT_TO_ADMIN
    if (submission.submissionType.type === 'FINAL_DRAFT' && hasChangesRequested && allMediaProcessed && submission.status === 'SENT_TO_CLIENT') {
      await prisma.submission.update({
        where: { id: submissionId },
        data: { status: 'SENT_TO_ADMIN' }
      });
      console.log(`V3 Final Draft Submission ${submissionId} status updated to SENT_TO_ADMIN (client requested changes and all media processed)`);
    } else if (submission.submissionType.type === 'FIRST_DRAFT' && hasChangesRequested && allMediaProcessed && submission.status === 'SENT_TO_CLIENT') {
      // For First Draft: if client requests changes and all media is processed, set status to SENT_TO_ADMIN
      await prisma.submission.update({
        where: { id: submissionId },
        data: { status: 'SENT_TO_ADMIN' }
      });
      console.log(`V3 First Draft Submission ${submissionId} status updated to SENT_TO_ADMIN (client requested changes and all media processed)`);
    } else if ((submission.status === 'PENDING_REVIEW' || submission.status === 'SENT_TO_CLIENT' || submission.status === 'CHANGES_REQUIRED') && allMediaReviewed) {
      if (hasChangesRequested) {
        // For any submission type with changes requested, set status to CHANGES_REQUIRED
        await prisma.submission.update({
          where: { id: submissionId },
          data: { status: 'CHANGES_REQUIRED' }
        });
        console.log(`V3 Submission ${submissionId} (${submission.submissionType.type}) status updated to CHANGES_REQUIRED (changes requested on at least one media)`);
              } else if (submission.status === 'PENDING_REVIEW' || submission.status === 'CHANGES_REQUIRED') {
          // For FINAL_DRAFT, require all media are approved before sending to client
          // Add detailed log for FINAL_DRAFT SENT_TO_CLIENT decision
          console.log('[FINAL_DRAFT SENT_TO_CLIENT Decision]', {
            type: submission.submissionType.type,
            allRequiredMediaUploaded,
            approvedVideos, uploadedVideos,
            approvedPhotos, uploadedPhotos,
            approvedRawFootages, uploadedRawFootages,
            hasChangesRequested,
            status: submission.status
          });
          
          // Check if all required media are uploaded and approved (sent to client)
          const allRequiredMediaUploadedAndApproved = 
            (!campaignRequiresVideos || (uploadedVideos > 0 && sentToClientVideos === uploadedVideos)) &&
            (!campaignRequiresPhotos || (uploadedPhotos > 0 && sentToClientPhotos === uploadedPhotos)) &&
            (!campaignRequiresRawFootage || (uploadedRawFootages > 0 && sentToClientRawFootages === uploadedRawFootages));
          
          if (
            submission.submissionType.type === 'FINAL_DRAFT' &&
            allRequiredMediaUploadedAndApproved &&
            !hasChangesRequested
          ) {
            await prisma.submission.update({
              where: { id: submissionId },
              data: { status: 'SENT_TO_CLIENT' }
            });
            console.log(`V3 FINAL_DRAFT Submission ${submissionId} status updated to SENT_TO_CLIENT (all uploaded media approved by admin)`);
          } else if (
            submission.submissionType.type !== 'FINAL_DRAFT' &&
            allRequiredMediaUploaded &&
            !hasChangesRequested
          ) {
            await prisma.submission.update({
              where: { id: submissionId },
              data: { status: 'SENT_TO_CLIENT' }
            });
            console.log(`V3 Submission ${submissionId} status updated to SENT_TO_CLIENT (all required media uploaded and reviewed, no changes requested)`);
          } else {
            console.log(`V3 Submission ${submissionId} NOT sent to client yet (required media not fully uploaded or not all approved or changes requested)`);
            console.log(`Debug - allRequiredMediaUploadedAndApproved: ${allRequiredMediaUploadedAndApproved}, hasChangesRequested: ${hasChangesRequested}`);
          }
        }
    } else if (allClientApproved && submission.status === 'SENT_TO_CLIENT' && !hasChangesRequested) {
      await prisma.submission.update({
        where: { id: submissionId },
        data: { status: 'CLIENT_APPROVED' }
      });
      console.log(`V3 Submission ${submissionId} status updated to CLIENT_APPROVED`);
      
      // Activate next submission in the workflow when current submission is approved
      // For First Draft: activate Final Draft only if changes were requested, otherwise activate Posting
      // For Final Draft: always activate Posting
      let nextSubmissionType;
      if (submission.submissionType.type === 'FIRST_DRAFT') {
        // Check if any media items have REVISION_REQUESTED status to determine if changes were requested
        const hasRevisionRequested = submission.video.some(v => v.status === 'REVISION_REQUESTED') ||
                                    submission.photos.some(p => p.status === 'REVISION_REQUESTED') ||
                                    submission.rawFootages.some(r => r.status === 'REVISION_REQUESTED');
        
        nextSubmissionType = hasRevisionRequested ? 'FINAL_DRAFT' : 'POSTING';
      } else if (submission.submissionType.type === 'FINAL_DRAFT') {
        nextSubmissionType = 'POSTING';
      } else {
        // No next submission for other types
        return;
      }

      const nextSubmission = await prisma.submission.findFirst({
        where: {
          userId: submission.userId,
          campaignId: submission.campaignId,
          submissionType: {
            type: nextSubmissionType as any
          }
        },
        include: {
          submissionType: true
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
        console.log(`V3 Next submission ${nextSubmission.id} (${nextSubmission.submissionType.type}) activated to IN_PROGRESS`);
      }
    } else if (!allClientApproved && submission.status === 'CLIENT_APPROVED') {
      // Revert status if it was incorrectly set to CLIENT_APPROVED
      console.log(`REVERTING: Submission ${submissionId} from CLIENT_APPROVED to SENT_TO_CLIENT because allClientApproved is ${allClientApproved}`);
      console.log(`REVERTING: Details - changesRequestedVideos: ${changesRequestedVideos}, changesRequestedPhotos: ${changesRequestedPhotos}, changesRequestedRawFootages: ${changesRequestedRawFootages}`);
      await prisma.submission.update({
        where: { id: submissionId },
        data: { status: 'SENT_TO_CLIENT' }
      });
      console.log(`V3 Submission ${submissionId} status reverted from CLIENT_APPROVED to SENT_TO_CLIENT`);
    }

  } catch (error) {
    console.error('Error checking and updating submission status V3:', error);
  }
};

// V3: Creator submits draft (First Draft or Final Draft)
export const submitDraftV3 = async (req: Request, res: Response) => {
  let submissionId, caption, photosDriveLink, rawFootagesDriveLink;
  const files = req.files as any;
  const creatorId = req.session.userid;

  try {
    // Parse JSON data with error handling
    try {
      const parsedData = JSON.parse(req.body.data);
      submissionId = parsedData.submissionId;
      caption = parsedData.caption;
      photosDriveLink = parsedData.photosDriveLink;
      rawFootagesDriveLink = parsedData.rawFootagesDriveLink;
    } catch (parseError) {
      console.error('V3 submit-draft JSON parse error:', parseError);
      return res.status(400).json({ message: 'Invalid request data format' });
    }

    if (!submissionId) {
      return res.status(400).json({ message: 'Submission ID is required' });
    }

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
                  include: { user: true }
                }
              }
            }
          }
        },
        video: true,
        photos: true,
        rawFootages: true,
      }
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

    // Check if submission is in correct status - allow more states for resubmission
    const allowedStatuses = ['IN_PROGRESS', 'CHANGES_REQUIRED', 'SENT_TO_ADMIN', 'NOT_STARTED'];
    if (!allowedStatuses.includes(submission.status)) {
      console.log(`V3 submit-draft rejected: submission ${submissionId} has status ${submission.status}, allowed: ${allowedStatuses.join(', ')}`);
      return res.status(400).json({ 
        message: `Submission is not in correct status for draft submission. Current status: ${submission.status}. Please refresh the page and try again.` 
      });
    }

    // Determine if there is at least one deliverable present (existing media or provided links/files)
    const existingMediaCount = (submission.video?.length || 0) + (submission.photos?.length || 0) + (submission.rawFootages?.length || 0);
    const hasDriveLinks = Boolean(photosDriveLink) || Boolean(rawFootagesDriveLink);

    // Normalize express-fileupload file shapes (single object or array)
    const draftVideos = Array.isArray((files as any)?.draftVideo)
      ? (files as any).draftVideo
      : (files as any)?.draftVideo
        ? [(files as any).draftVideo]
        : [];

    const uploadedPhotos = Array.isArray((files as any)?.photos)
      ? (files as any).photos
      : (files as any)?.photos
        ? [(files as any).photos]
        : [];

    const uploadedRawFootages = Array.isArray((files as any)?.rawFootage)
      ? (files as any).rawFootage
      : (files as any)?.rawFootage
        ? [(files as any).rawFootage]
        : [];

    // Debug logs for incoming files and links
    console.log('V3 submit-draft incoming payload:', {
      fileKeys: files ? Object.keys(files) : [],
      draftVideosCount: draftVideos.length,
      photosCount: uploadedPhotos.length,
      rawFootagesCount: uploadedRawFootages.length,
      hasDriveLinks,
      photosDriveLink: Boolean(photosDriveLink),
      rawFootagesDriveLink: Boolean(rawFootagesDriveLink),
      existingMediaCount,
      existingVideos: submission.video?.length || 0,
      existingPhotos: submission.photos?.length || 0,
      existingRawFootages: submission.rawFootages?.length || 0,
      submissionStatus: submission.status,
    });

    const hasUploadedFiles = draftVideos.length > 0 || uploadedPhotos.length > 0 || uploadedRawFootages.length > 0;

    if (existingMediaCount === 0 && !hasDriveLinks && !hasUploadedFiles) {
      console.log(`V3 submit-draft rejected: no deliverables found for submission ${submissionId}`);
      // Do not move to review without any deliverables
      await prisma.submission.update({
        where: { id: submissionId },
        data: {
          content: caption || null,
          photosDriveLink: photosDriveLink || null,
          rawFootagesDriveLink: rawFootagesDriveLink || null,
        }
      });
      return res.status(400).json({ message: 'Please upload at least one deliverable before submitting for review.' });
    }

    // Save caption and any provided drive links, but do not change status here
    await prisma.submission.update({
      where: { id: submissionId },
      data: {
        content: caption || null,
        photosDriveLink: photosDriveLink || null,
        rawFootagesDriveLink: rawFootagesDriveLink || null
      }
    });

    // Build local file paths and enqueue processing job (same worker/queue as V2)
  let amqp: amqplib.Connection | null = null;
  let channel: amqplib.Channel | null = null;

    const filePaths = new Map();

    // Handle draft videos (compress later in worker)
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

    // Handle raw footages
    if (uploadedRawFootages.length) {
      filePaths.set('rawFootages', []);
      const rawFootageArray = Array.isArray(uploadedRawFootages) ? uploadedRawFootages : [uploadedRawFootages];
      for (const rawFootage of rawFootageArray) {
        const rawFootagePath = `/tmp/${submissionId}_${rawFootage.name}`;
        try {
        await rawFootage.mv(rawFootagePath);
        filePaths.get('rawFootages').push(rawFootagePath);
        } catch (err) {
          // skip failed file move
        }
      }
    }

    // Handle photos
    if (uploadedPhotos.length) {
      filePaths.set('photos', []);
      for (const photo of uploadedPhotos) {
        const photoPath = `/tmp/${submissionId}_${photo.name}`;
        await photo.mv(photoPath);
        filePaths.get('photos').push(photoPath);
      }
    }

    try {
      amqp = await amqplib.connect(process.env.RABBIT_MQ!);
      channel = await amqp.createChannel();
      await channel.assertQueue('draft', { durable: true });

      const payload = {
        userid: creatorId,
        submissionId,
        campaignId: submission.campaignId,
        folder: submission.submissionType.type,
        caption,
        admins: submission.campaign.campaignAdmin,
        filePaths: Object.fromEntries(filePaths),
        // Add existing media info for worker to preserve
        existingMedia: {
          videos: submission.video?.map(v => ({ id: v.id, status: v.status })) || [],
          photos: submission.photos?.map(p => ({ id: p.id, status: p.status })) || [],
          rawFootages: submission.rawFootages?.map(r => ({ id: r.id, status: r.status })) || [],
        },
        preserveExistingMedia: true, // Flag to tell worker to preserve existing media
      };

      console.log('V3 submit-draft sending to worker:', {
        submissionId,
        filePaths: Object.keys(Object.fromEntries(filePaths)),
        existingMediaCounts: {
          videos: submission.video?.length || 0,
          photos: submission.photos?.length || 0,
          rawFootages: submission.rawFootages?.length || 0,
        },
        preserveExistingMedia: true,
      });

      channel.sendToQueue('draft', Buffer.from(JSON.stringify(payload)), { persistent: true });
  } finally {
    if (channel) await channel.close();
    if (amqp) await amqp.close();
    }

    // Let the worker update status based on uploaded items; keep current status here
    return res.status(200).json({ message: 'Draft processing started' });

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

    // Update submission status to SENT_TO_CLIENT
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
    console.log(`WARNING: Client ${clientId} calling approveDraftByClientV3 for submission ${submissionId}`);
    console.log(`WARNING: This endpoint should NOT be called for individual media approval!`);

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
      const nextSubmission = await prisma.submission.findFirst({
        where: {
          userId: submission.userId,
          campaignId: submission.campaignId,
          submissionType: {
            type: submission.submissionType.type === 'FIRST_DRAFT' ? 'FINAL_DRAFT' : 'POSTING'
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

    // Update submission status to SENT_TO_ADMIN
    await prisma.submission.update({
      where: { id: submissionId },
      data: {
        status: 'SENT_TO_ADMIN',
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
          message: `Client has requested changes for ${submission.submissionType.type.toLowerCase().replace('_', ' ')} in campaign "${submission.campaign.name}".`,
          entity: 'Draft',
          campaignId: submission.campaignId,
          userId: adminUser.admin.userId
        }
      });
    }

    console.log(`Changes requested by client for draft ${submissionId}, status updated to SENT_TO_ADMIN`);
    return res.status(200).json({ message: 'Changes requested by client' });

  } catch (error) {
    console.error('Error requesting changes by client V3:', error);
    return res.status(500).json({ message: 'Failed to request changes' });
  }
};

// V3: Admin forwards client posting feedback
export const forwardClientPostingFeedbackV3 = async (req: Request, res: Response) => {
  const { submissionId, adminFeedback } = req.body;
  const adminId = req.session.userid;

  try {
    console.log(`Admin ${adminId} forwarding client posting feedback for submission ${submissionId}`);

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

    // Check if submission is in correct status - allow both SENT_TO_ADMIN and CHANGES_REQUIRED
    if (submission.status !== 'SENT_TO_ADMIN' && submission.status !== 'CHANGES_REQUIRED') {
      return res.status(400).json({ 
        message: `Submission is not in correct status for forwarding feedback. Current status: ${submission.status}` 
      });
    }

    // Only update status if it's currently SENT_TO_ADMIN, otherwise keep it as CHANGES_REQUIRED
    if (submission.status === 'SENT_TO_ADMIN') {
    await prisma.submission.update({
      where: { id: submissionId },
      data: {
        status: 'CHANGES_REQUIRED'
      }
    });
    }

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
        title: 'Changes Required for Posting',
        message: `Changes have been requested for your posting in campaign "${submission.campaign.name}". Please review the feedback and resubmit.`,
        entity: 'Posting',
        campaignId: submission.campaignId,
        userId: submission.userId
      }
    });

    console.log(`Client posting feedback forwarded for submission ${submissionId}, status updated to CHANGES_REQUIRED`);
    return res.status(200).json({ message: 'Client posting feedback forwarded to creator' });

  } catch (error) {
    console.error('Error forwarding client posting feedback V3:', error);
    return res.status(500).json({ message: 'Failed to forward feedback' });
  }
}; 

// V3: Admin forwards client feedback for drafts
export const forwardClientFeedbackV3 = async (req: Request, res: Response) => {
  const { submissionId, adminFeedback } = req.body;
  const adminId = req.session.userid;

  try {
    console.log(`Admin ${adminId} forwarding client feedback for draft submission ${submissionId}`);

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

    // Check if submission is in correct status - allow both SENT_TO_ADMIN and CHANGES_REQUIRED
    if (submission.status !== 'SENT_TO_ADMIN' && submission.status !== 'CHANGES_REQUIRED') {
      return res.status(400).json({ 
        message: `Submission is not in correct status for forwarding feedback. Current status: ${submission.status}` 
      });
    }

    // Only update status if it's currently SENT_TO_ADMIN, otherwise keep it as CHANGES_REQUIRED
    if (submission.status === 'SENT_TO_ADMIN') {
      await prisma.submission.update({
        where: { id: submissionId },
        data: {
          status: 'CHANGES_REQUIRED'
        }
      });
    }

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
        message: `Changes have been requested for your ${submission.submissionType.type.toLowerCase().replace('_', ' ')} in campaign "${submission.campaign.name}". Please review the feedback and resubmit.`,
        entity: 'Draft',
        campaignId: submission.campaignId,
        userId: submission.userId
      }
    });

    console.log(`Client feedback forwarded for draft submission ${submissionId}, status updated to CHANGES_REQUIRED`);
    return res.status(200).json({ message: 'Client feedback forwarded to creator' });

  } catch (error) {
    console.error('Error forwarding client feedback V3:', error);
    return res.status(500).json({ message: 'Failed to forward feedback' });
  }
};

// V3: Admin reviews and forwards client feedback (alias for forwardClientFeedbackV3)
export const reviewAndForwardClientFeedbackV3 = async (req: Request, res: Response) => {
  return forwardClientFeedbackV3(req, res);
};

// V3: Approve submission by client (for individual media approval)
export const approveSubmissionByClientV3 = async (req: Request, res: Response) => {
  const { submissionId } = req.params;
  const clientId = req.session.userid;

  try {
    console.log(`WARNING: Client ${clientId} calling approveSubmissionByClientV3 for submission: ${submissionId}`);
    console.log(`WARNING: This endpoint should NOT be called for individual media approval!`);

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
    console.log(`WARNING: Setting submission ${submissionId} to CLIENT_APPROVED via approveSubmissionByClientV3`);
      await prisma.submission.update({
        where: { id: submissionId },
        data: {
          status: 'CLIENT_APPROVED',
          completedAt: new Date()
        }
      });

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

    console.log(`Submission ${submissionId} approved by client, status updated to CLIENT_APPROVED`);
    return res.status(200).json({ message: 'Submission approved by client' });

  } catch (error) {
    console.error('Error approving submission by client V3:', error);
    return res.status(500).json({ message: 'Failed to approve submission' });
  }
};

// V3: Admin approves posting
export const approvePostingByAdminV3 = async (req: Request, res: Response) => {
  const { submissionId, feedback } = req.body;
  const adminId = req.session.userid;

  try {
    console.log(`Admin ${adminId} approving posting V3 for submission ${submissionId}`);

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

    // Update submission status to APPROVED (admin can approve posting directly)
    await prisma.submission.update({
      where: { id: submissionId },
      data: {
        status: 'APPROVED',
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

    // Generate invoice for the creator
    try {
      const creator = await prisma.shortListedCreator.findFirst({
        where: {
          campaignId: submission.campaignId,
          userId: submission.userId,
        },
        select: {
          campaign: {
            select: {
              id: true,
              campaignBrief: true,
              name: true,
            },
          },
          isCampaignDone: true,
          user: {
            select: {
              paymentForm: true,
              id: true,
              name: true,
              email: true,
              creatorAgreement: true,
              creator: true,
            },
          },
        },
      });

      if (creator && !creator.isCampaignDone) {
        const invoiceAmount = creator?.user?.creatorAgreement.find(
          (elem) => elem.campaignId === creator.campaign.id,
        )?.amount;

        const invoice = await createInvoiceService(
          { ...creator, userId: creator.user?.id, campaignId: creator.campaign.id },
          adminId,
          invoiceAmount,
          undefined,
          undefined,
          adminId,
        );

        await prisma.shortListedCreator.update({
          where: {
            userId_campaignId: {
              userId: creator?.user?.id as string,
              campaignId: creator.campaign.id as string,
            },
          },
          data: {
            isCampaignDone: true,
          },
        });

        const images: any = creator.campaign.campaignBrief?.images;

        creatorInvoice(
          creator?.user?.email as any,
          creator.campaign.name,
          creator?.user?.name ?? 'Creator',
          images?.[0],
        );

        const { title, message } = notificationInvoiceGenerate(creator.campaign.name);

        await saveNotification({
          userId: creator.user?.id as any,
          title,
          message,
          invoiceId: invoice?.id,
          entity: 'Invoice',
          entityId: creator.campaign.id,
        });

        console.log(`Invoice generated for creator ${submission.userId} in campaign ${submission.campaignId}`);
      }
    } catch (error) {
      console.error('Error generating invoice:', error);
    }

    // Create congratulations notification for creator
      await prisma.notification.create({
        data: {
        title: '🎉 Congratulations! Campaign Completed!',
        message: `Congratulations! You have successfully completed the campaign "${submission.campaign.name}". Your invoice has been generated and you will receive payment soon.`,
        entity: 'Posting',
          campaignId: submission.campaignId,
        userId: submission.userId
        }
      });

    console.log(`Posting ${submissionId} approved by admin, status updated to APPROVED`);
    return res.status(200).json({ message: 'Posting approved by admin and invoice generated' });

  } catch (error) {
    console.error('Error approving posting by admin V3:', error);
    return res.status(500).json({ message: 'Failed to approve posting' });
  }
};

// V3: Admin requests changes for posting
export const requestChangesForPostingByAdminV3 = async (req: Request, res: Response) => {
  const { submissionId, feedback, reasons } = req.body;
  const adminId = req.session.userid;

  try {
    console.log(`Admin ${adminId} requesting changes for posting V3 submission ${submissionId}`);

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
        message: `Changes have been requested for your posting in campaign "${submission.campaign.name}".`,
        entity: 'Posting',
        campaignId: submission.campaignId,
        userId: submission.userId
      }
    });

    console.log(`Changes requested for posting ${submissionId}, status updated to CHANGES_REQUIRED`);
    return res.status(200).json({ message: 'Changes requested successfully' });

  } catch (error) {
    console.error('Error requesting changes for posting by admin V3:', error);
    return res.status(500).json({ message: 'Failed to request changes' });
  }
};

// V3: Client approves posting
export const approvePostingByClientV3 = async (req: Request, res: Response) => {
  const { submissionId, feedback } = req.body;
  const clientId = req.session.userid;

  try {
    console.log(`Client ${clientId} approving posting V3 for submission ${submissionId}`);

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

    // Generate invoice or mark campaign as completed
    console.log(`Posting approved by client - campaign ${submission.campaignId} completed`);
    // TODO: Add invoice generation logic here

    // Create notification for admin and creator
    const adminUsers = submission.campaign.campaignAdmin.filter(ca => 
      ca.admin.user.role === 'admin' || ca.admin.user.role === 'superadmin'
    );

    for (const adminUser of adminUsers) {
      await prisma.notification.create({
        data: {
          title: 'Posting Approved by Client',
          message: `A posting has been approved by client for campaign "${submission.campaign.name}".`,
          entity: 'Posting',
          campaignId: submission.campaignId,
          userId: adminUser.admin.userId
        }
      });
    }

    // Notify creator
    await prisma.notification.create({
      data: {
        title: 'Posting Approved',
        message: `Your posting has been approved by client for campaign "${submission.campaign.name}".`,
        entity: 'Posting',
        campaignId: submission.campaignId,
        userId: submission.userId
      }
    });

    console.log(`Posting ${submissionId} approved by client, status updated to CLIENT_APPROVED`);
    return res.status(200).json({ message: 'Posting approved by client' });

  } catch (error) {
    console.error('Error approving posting by client V3:', error);
    return res.status(500).json({ message: 'Failed to approve posting' });
  }
};

// V3: Client requests changes for posting
export const requestChangesForPostingByClientV3 = async (req: Request, res: Response) => {
  const { submissionId, feedback, reasons } = req.body;
  const clientId = req.session.userid;

  try {
    console.log(`Client ${clientId} requesting changes for posting V3 submission ${submissionId}`);

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

    // Update submission status to SENT_TO_ADMIN
    await prisma.submission.update({
      where: { id: submissionId },
      data: {
        status: 'SENT_TO_ADMIN',
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
          title: 'Client Requested Changes for Posting',
          message: `Client has requested changes for posting in campaign "${submission.campaign.name}".`,
          entity: 'Posting',
          campaignId: submission.campaignId,
          userId: adminUser.admin.userId
        }
      });
    }

    console.log(`Changes requested by client for posting ${submissionId}, status updated to SENT_TO_ADMIN`);
    return res.status(200).json({ message: 'Changes requested by client' });

  } catch (error) {
    console.error('Error requesting changes for posting by client V3:', error);
    return res.status(500).json({ message: 'Failed to request changes' });
  }
};
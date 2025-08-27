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
            campaign: true,
            video: true,
            photos: true,
            rawFootages: true
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
            campaign: true,
            video: true,
            photos: true,
            rawFootages: true
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
            campaign: true,
            video: true,
            photos: true,
            rawFootages: true
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

    console.log(`V3 ${mediaType} ${mediaId} approved by admin`);
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
            campaign: true,
            video: true,
            photos: true,
            rawFootages: true
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
            campaign: true,
            video: true,
            photos: true,
            rawFootages: true
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
            campaign: true,
            video: true,
            photos: true,
            rawFootages: true
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
      type: 'REASON',
      reasons: reasons,
      adminId: adminId,
      submissionId: submission.id,
    };

    // Add the correct field based on media type
    switch (mediaType) {
      case 'video':
        feedbackData.content = feedback;
        feedbackData.videosToUpdate = [mediaId];
        break;
      case 'photo':
        feedbackData.photoContent = feedback;
        feedbackData.photosToUpdate = [mediaId];
        break;
      case 'rawFootage':
        feedbackData.rawFootageContent = feedback;
        feedbackData.rawFootageToUpdate = [mediaId];
        break;
    }

    // Mark feedback as visible to creator so it shows immediately in creator UI
    const createdFeedback = await prisma.feedback.create({
      data: {
        ...feedbackData,
        sentToCreator: true,
      }
    });

    // Determine which submission to update status for
    let submissionToUpdate = submission.id;
    
    // For Final Draft submissions, we need to update the First Draft submission status
    const submissionType = await prisma.submissionType.findUnique({
      where: { id: submission.submissionTypeId }
    });
    
    if (submissionType?.type === 'FINAL_DRAFT') {
      const firstDraftSubmission = await prisma.submission.findFirst({
        where: {
          userId: submission.userId,
          campaignId: submission.campaignId,
          submissionType: { type: 'FIRST_DRAFT' }
        }
      });
      
      if (firstDraftSubmission) {
        submissionToUpdate = firstDraftSubmission.id;
      }
    }

    // Check and update submission status
    await checkAndUpdateSubmissionStatusV3(submissionToUpdate, adminId);

    // For Final Draft, also check and update Final Draft submission status
    if (submissionType?.type === 'FINAL_DRAFT') {
      await checkAndUpdateSubmissionStatusV3(submission.id, adminId);
    }

    console.log(`V3 ${mediaType} ${mediaId} changes requested by admin`);
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
        type: 'COMMENT',
        adminId: clientId,
        submissionId: submission.id,
      };

      // Add the correct content field based on media type
      switch (mediaType) {
        case 'video':
          feedbackData.content = feedback;
          feedbackData.videosToUpdate = [mediaId];
          break;
        case 'photo':
          feedbackData.photoContent = feedback;
          feedbackData.photosToUpdate = [mediaId];
          break;
        case 'rawFootage':
          feedbackData.rawFootageContent = feedback;
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

    // Update media status to CLIENT_FEEDBACK (client requests changes)
    let updatedMedia;
    switch (mediaType) {
      case 'video':
        updatedMedia = await prisma.video.update({
          where: { id: mediaId },
          data: { status: 'CLIENT_FEEDBACK' }
        });
        break;
      case 'photo':
        updatedMedia = await prisma.photo.update({
          where: { id: mediaId },
          data: { status: 'CLIENT_FEEDBACK' }
        });
        break;
      case 'rawFootage':
        updatedMedia = await prisma.rawFootage.update({
          where: { id: mediaId },
          data: { status: 'CLIENT_FEEDBACK' }
        });
        break;
      default:
        return res.status(400).json({ message: 'Invalid media type' });
    }

    // Create feedback
    const feedbackData: any = {
      type: 'REASON',
      reasons: reasons,
      adminId: clientId,
      submissionId: submission.id,
    };

    // Add the correct content field based on media type
    switch (mediaType) {
      case 'video':
        feedbackData.content = feedback;
        feedbackData.videosToUpdate = [mediaId];
        break;
      case 'photo':
        feedbackData.photoContent = feedback;
        feedbackData.photosToUpdate = [mediaId];
        break;
      case 'rawFootage':
        feedbackData.rawFootageContent = feedback;
        feedbackData.rawFootageToUpdate = [mediaId];
        break;
    }

    await prisma.feedback.create({
      data: feedbackData
    });

    // Check and update submission status
    let submissionToUpdate = submission.id;
    
    if (submission.submissionTypeId) {
      const submissionType = await prisma.submissionType.findUnique({
        where: { id: submission.submissionTypeId }
      });
    }
    
    await checkAndUpdateSubmissionStatusV3(submissionToUpdate, clientId);

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

    // For First Draft, count media from ALL submissions for the same user/campaign
    let uploadedVideos = 0;
    let uploadedPhotos = 0;
    let uploadedRawFootages = 0;
    let approvedVideos = 0;
    let approvedPhotos = 0;
    let approvedRawFootages = 0;
    let sentToClientVideos = 0;
    let sentToClientPhotos = 0;
    let sentToClientRawFootages = 0;
    let changesRequestedVideos = 0;
    let changesRequestedPhotos = 0;
    let changesRequestedRawFootages = 0;

    // Get First Draft submission for both First Draft and Final Draft logic
    let firstDraftSubmission = null;
    if (submission.submissionType.type === 'FINAL_DRAFT') {
      firstDraftSubmission = await prisma.submission.findFirst({
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
    }

    if (submission.submissionType.type === 'FIRST_DRAFT') {
      // Get ALL submissions for this user/campaign to count total media
      const allSubmissions = await prisma.submission.findMany({
        where: {
          userId: submission.userId,
          campaignId: submission.campaignId
        },
        include: {
          video: true,
          photos: true,
          rawFootages: true,
        }
      });

      // Count media from ALL submissions
      allSubmissions.forEach((sub) => {
        uploadedVideos += sub.video.length;
        uploadedPhotos += sub.photos.length;
        uploadedRawFootages += sub.rawFootages.length;
        
        approvedVideos += sub.video.filter(v => v.status === 'APPROVED').length;
        approvedPhotos += sub.photos.filter(p => p.status === 'APPROVED').length;
        approvedRawFootages += sub.rawFootages.filter(r => r.status === 'APPROVED').length;
        
        sentToClientVideos += sub.video.filter(v => v.status === 'SENT_TO_CLIENT').length;
        sentToClientPhotos += sub.photos.filter(p => p.status === 'SENT_TO_CLIENT').length;
        sentToClientRawFootages += sub.rawFootages.filter(r => r.status === 'SENT_TO_CLIENT').length;
        
        changesRequestedVideos += sub.video.filter(v => v.status === 'REVISION_REQUESTED' || v.status === 'CLIENT_FEEDBACK').length;
        changesRequestedPhotos += sub.photos.filter(p => p.status === 'REVISION_REQUESTED' || p.status === 'CLIENT_FEEDBACK').length;
        changesRequestedRawFootages += sub.rawFootages.filter(r => r.status === 'REVISION_REQUESTED' || r.status === 'CLIENT_FEEDBACK').length;
      });
    } else {
      // For Final Draft, count media from current submission + approved media from First Draft
      uploadedVideos = submission.video.length;
      uploadedPhotos = submission.photos.length;
      uploadedRawFootages = submission.rawFootages.length;

      if (firstDraftSubmission) {
        // Count approved media from First Draft
        const approvedFirstDraftVideos = firstDraftSubmission.video.filter(v => v.status === 'APPROVED' || v.status === 'SENT_TO_CLIENT').length;
        const approvedFirstDraftPhotos = firstDraftSubmission.photos.filter(p => p.status === 'APPROVED' || p.status === 'SENT_TO_CLIENT').length;
        const approvedFirstDraftRawFootages = firstDraftSubmission.rawFootages.filter(r => r.status === 'APPROVED' || r.status === 'SENT_TO_CLIENT').length;

        // Add approved First Draft media to Final Draft counts
        uploadedVideos += approvedFirstDraftVideos;
        uploadedPhotos += approvedFirstDraftPhotos;
        uploadedRawFootages += approvedFirstDraftRawFootages;
      }

      // Count approved media items (client approved) - from current submission only
      approvedVideos = submission.video.filter(v => v.status === 'APPROVED').length;
      approvedPhotos = submission.photos.filter(p => p.status === 'APPROVED').length;
      approvedRawFootages = submission.rawFootages.filter(r => r.status === 'APPROVED').length;

      // Count media sent to client (admin approved) - from current submission only
      sentToClientVideos = submission.video.filter(v => v.status === 'SENT_TO_CLIENT').length;
      sentToClientPhotos = submission.photos.filter(p => p.status === 'SENT_TO_CLIENT').length;
      sentToClientRawFootages = submission.rawFootages.filter(r => r.status === 'SENT_TO_CLIENT').length;

      // For Final Draft, also count approved media from First Draft
      if (firstDraftSubmission) {
        // Count approved media from First Draft
        const approvedFirstDraftVideos = firstDraftSubmission.video.filter(v => v.status === 'APPROVED').length;
        const approvedFirstDraftPhotos = firstDraftSubmission.photos.filter(p => p.status === 'APPROVED').length;
        const approvedFirstDraftRawFootages = firstDraftSubmission.rawFootages.filter(r => r.status === 'APPROVED').length;

        // Add approved First Draft media to Final Draft counts
        approvedVideos += approvedFirstDraftVideos;
        approvedPhotos += approvedFirstDraftPhotos;
        approvedRawFootages += approvedFirstDraftRawFootages;

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

    // Count media with changes requested (for Final Draft, use current submission only)
    if (submission.submissionType.type === 'FIRST_DRAFT') {
      // For First Draft, we already counted changes requested from all submissions above
      // No need to do anything here
    } else {
      // For Final Draft, count changes requested from current submission only
      changesRequestedVideos = submission.video.filter(v => v.status === 'REVISION_REQUESTED' || v.status === 'CLIENT_FEEDBACK').length;
      changesRequestedPhotos = submission.photos.filter(p => p.status === 'REVISION_REQUESTED' || p.status === 'CLIENT_FEEDBACK').length;
      changesRequestedRawFootages = submission.rawFootages.filter(r => r.status === 'REVISION_REQUESTED' || r.status === 'CLIENT_FEEDBACK').length;
    }

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
      // Additional check: no media items should have REVISION_REQUESTED or CLIENT_FEEDBACK status
      changesRequestedVideos === 0 &&
      changesRequestedPhotos === 0 &&
      changesRequestedRawFootages === 0;
      
    // Check if all media items have been processed (either approved or changes requested)
    const allMediaProcessed = 
      (uploadedVideos === 0 || approvedVideos + changesRequestedVideos === uploadedVideos) &&
      (uploadedPhotos === 0 || approvedPhotos + changesRequestedPhotos === uploadedPhotos) &&
      (uploadedRawFootages === 0 || approvedRawFootages + changesRequestedRawFootages === uploadedRawFootages);

    // Update submission status based on conditions
    const hasChangesRequested = (changesRequestedVideos > 0) || (changesRequestedPhotos > 0) || (changesRequestedRawFootages > 0);

    // Priority 0: Handle admin-requested changes (REVISION_REQUESTED status)
    const hasAdminRequestedChanges = submission.video.some(v => v.status === 'REVISION_REQUESTED') ||
                                    submission.photos.some(p => p.status === 'REVISION_REQUESTED') ||
                                    submission.rawFootages.some(r => r.status === 'REVISION_REQUESTED');
    
    // Check if all media has been reviewed by admin (either approved or changes requested)
    const videosReviewed = uploadedVideos === 0 || (sentToClientVideos + changesRequestedVideos === uploadedVideos);
    const photosReviewed = uploadedPhotos === 0 || (sentToClientPhotos + changesRequestedPhotos === uploadedPhotos);
    const rawFootagesReviewed = uploadedRawFootages === 0 || (sentToClientRawFootages + changesRequestedRawFootages === uploadedRawFootages);
    
    // Only count media types that actually have items uploaded
    const hasVideos = uploadedVideos > 0;
    const hasPhotos = uploadedPhotos > 0;
    const hasRawFootages = uploadedRawFootages > 0;
    
    // Only count as "reviewed" if admin has made decisions on ALL media types that actually have items
    const allMediaActuallyReviewed = 
      (!hasVideos || (sentToClientVideos + changesRequestedVideos === uploadedVideos)) &&
      (!hasPhotos || (sentToClientPhotos + changesRequestedPhotos === uploadedPhotos)) &&
      (!hasRawFootages || (sentToClientRawFootages + changesRequestedRawFootages === uploadedRawFootages));
    
    const allMediaReviewedByAdmin = videosReviewed && photosReviewed && rawFootagesReviewed && allMediaActuallyReviewed;
    
    // For Final Draft, also allow NOT_STARTED status to be changed to CHANGES_REQUIRED
    const allowedStatusesForChangesRequired = submission.submissionType.type === 'FINAL_DRAFT' 
      ? ['PENDING_REVIEW', 'SENT_TO_CLIENT', 'SENT_TO_ADMIN', 'NOT_STARTED']
      : ['PENDING_REVIEW', 'SENT_TO_CLIENT', 'SENT_TO_ADMIN'];
    
    const shouldChangeToChangesRequired = hasAdminRequestedChanges && 
                                        allMediaReviewedByAdmin && 
                                        allowedStatusesForChangesRequired.includes(submission.status);
    
    if (shouldChangeToChangesRequired) {
      await prisma.submission.update({
        where: { id: submissionId },
        data: { status: 'CHANGES_REQUIRED' }
      });
      console.log(`V3 Submission ${submissionId} status updated to CHANGES_REQUIRED (admin requested changes and all media reviewed)`);
      return; // Exit early to prevent other status changes
    }

    // Priority 1: Handle client-requested changes (CLIENT_FEEDBACK status) for First Draft and Final Draft submissions
    let hasClientRequestedChanges = submission.video.some(v => v.status === 'CLIENT_FEEDBACK') ||
                                   submission.photos.some(p => p.status === 'CLIENT_FEEDBACK') ||
                                   submission.rawFootages.some(r => r.status === 'CLIENT_FEEDBACK');
    
    // 🔍 FIXED: Final Draft should only be marked as CLIENT_FEEDBACK if it has its own CLIENT_FEEDBACK items
    // First Draft CLIENT_FEEDBACK status should not affect Final Draft status
    if (submission.submissionType.type === 'FINAL_DRAFT') {
      console.log(`🔍 Final Draft - Only checking its own media for CLIENT_FEEDBACK status`);
      console.log(`🔍 Final Draft - Current submission hasClientRequestedChanges: ${hasClientRequestedChanges}`);
    }
    
    console.log(`🔍 Priority 1 Debug - Submission ${submissionId}:`, {
      hasClientRequestedChanges,
      currentStatus: submission.status,
      submissionType: submission.submissionType?.type,
      videoStatuses: submission.video.map(v => ({ id: v.id, status: v.status })),
      photoStatuses: submission.photos.map(p => ({ id: p.id, status: p.status })),
      rawFootageStatuses: submission.rawFootages.map(r => ({ id: r.id, status: r.status }))
    });
    
    console.log(`🔍 Priority 1 Condition Check - Submission ${submissionId}:`, {
      hasClientRequestedChanges,
      statusIsSENT_TO_CLIENT: submission.status === 'SENT_TO_CLIENT',
      statusIsPENDING_REVIEW: submission.status === 'PENDING_REVIEW',
      conditionMet: hasClientRequestedChanges && (submission.status === 'SENT_TO_CLIENT' || submission.status === 'PENDING_REVIEW')
    });
    
    // 🔍 FIXED: Only update to CLIENT_FEEDBACK when ALL media has been reviewed by client
    // This prevents hiding other media items that are still in SENT_TO_CLIENT status
    if (hasClientRequestedChanges) {
      // Check if all media has been reviewed by client (either approved or changes requested)
      const allMediaReviewedByClient = 
        (uploadedVideos === 0 || (approvedVideos + changesRequestedVideos === uploadedVideos)) &&
        (uploadedPhotos === 0 || (approvedPhotos + changesRequestedPhotos === uploadedPhotos)) &&
        (uploadedRawFootages === 0 || (approvedRawFootages + changesRequestedRawFootages === uploadedRawFootages));
      
      console.log(`🔍 FIXED: Client review check for submission ${submissionId}:`, {
        hasClientRequestedChanges,
        allMediaReviewedByClient,
        mediaCounts: {
          videos: { uploaded: uploadedVideos, approved: approvedVideos, changesRequested: changesRequestedVideos },
          photos: { uploaded: uploadedPhotos, approved: approvedPhotos, changesRequested: changesRequestedPhotos },
          rawFootages: { uploaded: uploadedRawFootages, approved: approvedRawFootages, changesRequested: changesRequestedRawFootages }
        }
      });
      
      // Only change to CLIENT_FEEDBACK when client has reviewed ALL media items
      if (allMediaReviewedByClient) {
        console.log(`🔍 FIXED: All media reviewed by client, updating submission status to CLIENT_FEEDBACK`);
        await prisma.submission.update({
          where: { id: submissionId },
          data: { status: 'CLIENT_FEEDBACK' }
        });
        console.log(`🔍 FIXED: V3 Submission ${submissionId} status updated to CLIENT_FEEDBACK (all media reviewed by client)`);
        return; // Exit early to prevent other status changes
      } else {
        console.log(`🔍 FIXED: Client requested changes but not all media reviewed yet - keeping current status ${submission.status}`);
        // Keep current status until client reviews all media items
      }
    }
    


    // Priority 2: Handle admin review and approval logic
    if ((submission.status === 'PENDING_REVIEW' || submission.status === 'CHANGES_REQUIRED' || submission.status === 'CLIENT_FEEDBACK')) {
      // Check if admin has approved enough media to send to client
      const hasApprovedMedia = sentToClientVideos > 0 || sentToClientPhotos > 0 || sentToClientRawFootages > 0;
      const hasChangesRequested = changesRequestedVideos > 0 || changesRequestedPhotos > 0 || changesRequestedRawFootages > 0;
      
      if (submission.status === 'PENDING_REVIEW' || submission.status === 'CHANGES_REQUIRED' || submission.status === 'CLIENT_FEEDBACK') {
          // Check if all media has been reviewed by admin (either approved or changes requested)
          const allMediaReviewedByAdmin = 
            (uploadedVideos === 0 || (sentToClientVideos + changesRequestedVideos === uploadedVideos)) &&
            (uploadedPhotos === 0 || (sentToClientPhotos + changesRequestedPhotos === uploadedPhotos)) &&
            (uploadedRawFootages === 0 || (sentToClientRawFootages + changesRequestedRawFootages === uploadedRawFootages));
          
          // Check if all required media are uploaded and approved (sent to client)
          const allRequiredMediaUploadedAndApproved = 
            (!campaignRequiresVideos || (uploadedVideos > 0 && sentToClientVideos === uploadedVideos)) &&
            (!campaignRequiresPhotos || (uploadedPhotos > 0 && sentToClientPhotos === uploadedPhotos)) &&
            (!campaignRequiresRawFootage || (uploadedRawFootages > 0 && sentToClientRawFootages === uploadedRawFootages));
          
          // More detailed condition checking for both First Draft and Final Draft
          const currentChangesRequested = 
            submission.video.some(v => v.status === 'REVISION_REQUESTED' || v.status === 'CLIENT_FEEDBACK') ||
            submission.photos.some(p => p.status === 'REVISION_REQUESTED' || p.status === 'CLIENT_FEEDBACK') ||
            submission.rawFootages.some(r => r.status === 'REVISION_REQUESTED' || r.status === 'CLIENT_FEEDBACK');
          
          const shouldSendToClient = 
            (submission.submissionType.type === 'FIRST_DRAFT' || submission.submissionType.type === 'FINAL_DRAFT') &&
            allRequiredMediaUploadedAndApproved &&
            allMediaReviewedByAdmin &&
            !currentChangesRequested;

          if (shouldSendToClient) {
            await prisma.submission.update({
              where: { id: submissionId },
              data: { status: 'SENT_TO_CLIENT' }
            });
            console.log(`V3 ${submission.submissionType.type} Submission ${submissionId} status updated to SENT_TO_CLIENT (all uploaded media approved by admin)`);
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
            // Check if any media items have REVISION_REQUESTED or CLIENT_FEEDBACK status to determine if changes were requested
    const hasRevisionRequested = submission.video.some(v => v.status === 'REVISION_REQUESTED' || v.status === 'CLIENT_FEEDBACK') ||
    submission.photos.some(p => p.status === 'REVISION_REQUESTED' || p.status === 'CLIENT_FEEDBACK') ||
    submission.rawFootages.some(r => r.status === 'REVISION_REQUESTED' || r.status === 'CLIENT_FEEDBACK');
        
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

// Controller wrapper so creators/clients can trigger the status check via HTTP
export const triggerCheckAndUpdateSubmissionStatusV3 = async (req: Request, res: Response) => {
  try {
    const { submissionId } = req.body;
    const userId = req.session.userid;
    if (!submissionId) {
      return res.status(400).json({ message: 'submissionId is required' });
    }

    // Fetch the submission and campaign requirements
    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        campaign: true,
        video: true,
        photos: true,
        rawFootages: true,
        submissionType: true,
      },
    });

    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    // Only applies to First Draft
    if (submission.submissionType?.type !== 'FIRST_DRAFT') {
      await checkAndUpdateSubmissionStatusV3(submissionId, userId);
      return res.status(200).json({ message: 'Status check triggered (non-first draft)' });
    }

    // Simple completeness check: require at least one draft video (or content),
    // and photos/rawFootages if the campaign requires them
    const requiresPhotos = !!submission.campaign?.photos;
    const requiresRaw = !!submission.campaign?.rawFootage;
    const hasVideo = (submission.video?.length ?? 0) > 0 || !!submission.content;
    const hasPhotos = (submission.photos?.length ?? 0) > 0;
    const hasRaw = (submission.rawFootages?.length ?? 0) > 0;

    const complete = hasVideo && (!requiresPhotos || hasPhotos) && (!requiresRaw || hasRaw);

    if (complete) {
      await prisma.submission.update({
        where: { id: submissionId },
        data: { status: 'PENDING_REVIEW', submissionDate: new Date() },
      });
      return res.status(200).json({ message: 'Submission moved to PENDING_REVIEW' });
    }

    // Fallback to the comprehensive checker (will keep IN_PROGRESS if not ready)
    await checkAndUpdateSubmissionStatusV3(submissionId, userId);
    return res.status(200).json({ message: 'Not all deliverables uploaded yet' });
  } catch (error) {
    console.error('Error triggering status check:', error);
    return res.status(500).json({ message: 'Failed to trigger status check' });
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

    // 🔍 FIXED: Check if all required deliverables are uploaded before updating status
    const campaignRequiresVideos = true; // Always required
    const campaignRequiresPhotos = submission.campaign.photos;
    const campaignRequiresRawFootage = submission.campaign.rawFootage;

    // Count existing media
    const existingVideos = submission.video?.length || 0;
    const existingPhotos = submission.photos?.length || 0;
    const existingRawFootages = submission.rawFootages?.length || 0;

    // Count new uploads
    const newVideos = draftVideos.length;
    const newPhotos = uploadedPhotos.length;
    const newRawFootages = uploadedRawFootages.length;

    // Check if all required deliverables are present
    const hasRequiredVideos = (existingVideos + newVideos) > 0;
    const hasRequiredPhotos = !campaignRequiresPhotos || (existingPhotos + newPhotos) > 0;
    const hasRequiredRawFootage = !campaignRequiresRawFootage || (existingRawFootages + newRawFootages) > 0;

    const allRequiredDeliverablesUploaded = hasRequiredVideos && hasRequiredPhotos && hasRequiredRawFootage;

    console.log(`🔍 FIXED: Deliverable check for submission ${submissionId}:`, {
      campaignRequiresVideos,
      campaignRequiresPhotos,
      campaignRequiresRawFootage,
      existingVideos,
      existingPhotos,
      existingRawFootages,
      newVideos,
      newPhotos,
      newRawFootages,
      hasRequiredVideos,
      hasRequiredPhotos,
      hasRequiredRawFootage,
      allRequiredDeliverablesUploaded
    });

    // If specific media types have REVISION_REQUESTED/CLIENT_FEEDBACK, require a fresh upload for that type in this submission attempt
    const rawNeedsResubmission = campaignRequiresRawFootage && submission.rawFootages.some(r => r.status === 'REVISION_REQUESTED' || r.status === 'CLIENT_FEEDBACK');
    const photosNeedResubmission = campaignRequiresPhotos && submission.photos.some(p => p.status === 'REVISION_REQUESTED' || p.status === 'CLIENT_FEEDBACK');
    const videosNeedResubmission = campaignRequiresVideos && submission.video.some(v => v.status === 'REVISION_REQUESTED' || v.status === 'CLIENT_FEEDBACK');

    const resubmissionRequirementsSatisfied =
      (!videosNeedResubmission || newVideos > 0) &&
      (!photosNeedResubmission || newPhotos > 0) &&
      (!rawNeedsResubmission || newRawFootages > 0);

    // Only update status to PENDING_REVIEW if all required deliverables are uploaded,
    // and any requested revisions have fresh uploads for those media types
    if (allRequiredDeliverablesUploaded && resubmissionRequirementsSatisfied) {
      await prisma.submission.update({
        where: { id: submissionId },
        data: {
          status: 'PENDING_REVIEW'
        }
      });

      console.log(`🔍 FIXED: Submission ${submissionId} status updated to PENDING_REVIEW (all deliverables uploaded)`);

      // Verify the status was updated
      const updatedSubmission = await prisma.submission.findUnique({
        where: { id: submissionId },
        select: { status: true }
      });
      console.log(`🔍 FIXED: Verified submission ${submissionId} status after update: ${updatedSubmission?.status}`);

      return res.status(200).json({ message: 'Draft submitted successfully and sent for review' });
    } else {
      console.log(`🔍 FIXED: Submission ${submissionId} keeping IN_PROGRESS status (missing required deliverables)`);
      return res.status(200).json({ message: 'Draft uploaded successfully. Please upload all required deliverables and address requested revisions before submitting for review.' });
    }

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

    // Guard: If FE accidentally sent FIRST_DRAFT id from Final Draft admin, redirect to the dependent FINAL_DRAFT
    let targetSubmissionId = submissionId;
    if (submission.submissionType.type === 'FIRST_DRAFT') {
      // Correct mapping: find dependency where the current FIRST_DRAFT is the base submission,
      // and the dependent is the FINAL_DRAFT we want to update
      const dep = await prisma.submissionDependency.findFirst({
        where: { submissionId: submissionId },
        select: {
          dependentSubmissionId: true,
          dependentSubmission: { select: { submissionType: true } },
        },
      });
      if (dep?.dependentSubmissionId && dep.dependentSubmission?.submissionType?.type === 'FINAL_DRAFT') {
        console.log(`⚠️ approveDraftByAdminV3: Received FIRST_DRAFT id ${submissionId}, redirecting to FINAL_DRAFT ${dep.dependentSubmissionId}`);
        targetSubmissionId = dep.dependentSubmissionId;
      }
    }

    // Update submission status to SENT_TO_CLIENT for the correct (final draft) submission
    await prisma.submission.update({
      where: { id: targetSubmissionId },
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
          submissionId: targetSubmissionId
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

    console.log(`Draft ${targetSubmissionId} approved by admin, status updated to SENT_TO_CLIENT`);
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
    console.log(`🔍 Admin request changes - Current submission status: ${submission.status}`);
    console.log(`🔍 Admin request changes - Submission type: ${submission.submissionType?.type}`);
    
    // Allow more statuses for admin to request changes
    const allowedStatuses = ['PENDING_REVIEW', 'SENT_TO_ADMIN', 'CLIENT_FEEDBACK'];
    if (!allowedStatuses.includes(submission.status)) {
      return res.status(400).json({ 
        message: `Submission is not in correct status for changes request. Current status: ${submission.status}. Allowed statuses: ${allowedStatuses.join(', ')}` 
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

    console.log(`🔍 Admin request changes - Status updated to CHANGES_REQUIRED for submission ${submissionId}`);

    // Verify the status was updated
    const updatedSubmission = await prisma.submission.findUnique({
      where: { id: submissionId },
      select: { status: true }
    });
    console.log(`🔍 Admin request changes - Verified status after update: ${updatedSubmission?.status}`);

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
          title: 'Client Requested Changes for Posting',
          message: `Client has requested changes for posting in campaign "${submission.campaign.name}".`,
          entity: 'Posting',
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

    // Note: Do NOT immediately change status to CHANGES_REQUIRED here.
    // We will only change status when ALL media with REVISION_REQUESTED have been reviewed/forwarded.

    // Extract media from body first to avoid TDZ errors
    const { mediaId, mediaType } = req.body as any;

    // Add/forward feedback for the specific media to creator (carry over client feedback details when possible)
    if (mediaId && mediaType) {
      // Try to find the latest client feedback that references this media
      const sourceFeedback = await prisma.feedback.findFirst({
        where: {
          submissionId,
          OR: [
            { videosToUpdate: { has: mediaId } },
            { photosToUpdate: { has: mediaId } },
            { rawFootageToUpdate: { has: mediaId } },
          ],
        },
        orderBy: { createdAt: 'desc' },
      });

      const baseData: any = {
        adminId: adminId,
        submissionId: submissionId,
        sentToCreator: true,
      };

      if (mediaType === 'video') {
        baseData.videosToUpdate = [mediaId];
        baseData.content = sourceFeedback?.content || adminFeedback || 'Changes requested';
        baseData.reasons = sourceFeedback?.reasons || [];
        baseData.type = sourceFeedback?.type || 'REQUEST';
      } else if (mediaType === 'photo') {
        baseData.photosToUpdate = [mediaId];
        baseData.photoContent = sourceFeedback?.photoContent || sourceFeedback?.content || adminFeedback || 'Changes requested';
        baseData.reasons = sourceFeedback?.reasons || [];
        baseData.type = sourceFeedback?.type || 'REQUEST';
      } else if (mediaType === 'rawFootage') {
        baseData.rawFootageToUpdate = [mediaId];
        baseData.rawFootageContent = sourceFeedback?.rawFootageContent || sourceFeedback?.content || adminFeedback || 'Changes requested';
        baseData.reasons = sourceFeedback?.reasons || [];
        baseData.type = sourceFeedback?.type || 'REQUEST';
      }

      await prisma.feedback.create({ data: baseData });
    } else if (adminFeedback) {
      // Fallback: if no media provided, store a general comment for the submission
      await prisma.feedback.create({
        data: {
          content: adminFeedback,
          type: 'COMMENT',
          adminId: adminId,
          submissionId: submissionId,
          sentToCreator: true,
        },
      });
    }
 
    // Re-load submission with media to evaluate whether all revision-requested items were forwarded
    const subWithMedia = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        video: true,
        photos: true,
        rawFootages: true,
        submissionType: true,
      }
    });
 
    // Count only CLIENT_FEEDBACK items that still need to be processed
    // REVISION_REQUESTED items have already been sent to creator
    const changesRequestedVideos = subWithMedia?.video.filter(v => v.status === 'CLIENT_FEEDBACK').map(v => v.id) || [];
    const changesRequestedPhotos = subWithMedia?.photos.filter(p => p.status === 'CLIENT_FEEDBACK').map(p => p.id) || [];
    const changesRequestedRawFootages = subWithMedia?.rawFootages.filter(r => r.status === 'CLIENT_FEEDBACK').map(r => r.id) || [];
 

 
    // Check if all CLIENT_FEEDBACK items have been processed
    // Since we're only counting CLIENT_FEEDBACK items now, if the count is 0, all have been processed
    const allRevisionReviewed = 
      changesRequestedVideos.length === 0 &&
      changesRequestedPhotos.length === 0 &&
      changesRequestedRawFootages.length === 0;
 
    if (submission.status === 'SENT_TO_ADMIN' && allRevisionReviewed) {
      await prisma.submission.update({
        where: { id: submissionId },
        data: { status: 'CHANGES_REQUIRED' }
      });
      console.log(`Client feedback forwarded for submission ${submissionId}, all CLIENT_FEEDBACK items processed → status CHANGES_REQUIRED`);
    } else {
      console.log(`Client feedback forwarded for submission ${submissionId}, ${changesRequestedVideos.length + changesRequestedPhotos.length + changesRequestedRawFootages.length} CLIENT_FEEDBACK items remaining → status remains SENT_TO_ADMIN`);
    }

    // Create notification for creator
    await prisma.notification.create({
      data: {
        title: 'Changes Required',
        message: `Changes have been requested for your ${submission.submissionType.type.toLowerCase().replace('_', ' ')} in campaign "${submission.campaign.name}".`,
        entity: 'Draft',
        campaignId: submission.campaignId,
        userId: submission.userId
      }
    });

    return res.status(200).json({ message: 'Client feedback forwarded to creator' });

  } catch (error) {
    console.error('Error forwarding client posting feedback V3:', error);
    return res.status(500).json({ message: 'Failed to forward feedback' });
  }
}; 

// V3: Admin forwards client feedback for drafts
export const forwardClientFeedbackV3 = async (req: Request, res: Response) => {
  const { submissionId, adminFeedback, mediaId, mediaType, feedbackId } = req.body;
  const adminId = req.session.userid;

  try {
    console.log('➡️  [forwardClientFeedbackV3] payload:', {
      submissionId,
      adminId,
      hasAdminFeedback: !!adminFeedback,
      mediaId,
      mediaType,
      feedbackId,
    });

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

    // Check if submission is in correct status - allow SENT_TO_ADMIN, CHANGES_REQUIRED, and CLIENT_FEEDBACK
    if (submission.status !== 'SENT_TO_ADMIN' && submission.status !== 'CHANGES_REQUIRED' && submission.status !== 'CLIENT_FEEDBACK') {
      return res.status(400).json({ 
        message: `Submission is not in correct status for forwarding feedback. Current status: ${submission.status}` 
      });
    }

    // Add/forward feedback for the specific media to creator (carry over client feedback details when possible)
    let createdFeedback: any = null;

    if (mediaId && mediaType) {
      // Prefer an explicitly provided feedbackId; fall back to latest by media
      let sourceFeedback = null as any;
      if (feedbackId) {
        sourceFeedback = await prisma.feedback.findUnique({ where: { id: feedbackId } });
      }
      if (!sourceFeedback) {
        sourceFeedback = await prisma.feedback.findFirst({
          where: {
            submissionId,
            OR: [
              { videosToUpdate: { has: mediaId } },
              { photosToUpdate: { has: mediaId } },
              { rawFootageToUpdate: { has: mediaId } },
            ],
          },
          orderBy: { createdAt: 'desc' },
        });
      }

      const baseData: any = {
        adminId: adminId,
        submissionId: submissionId,
        sentToCreator: true,
      };

      if (mediaType === 'video') {
        baseData.videosToUpdate = [mediaId];
        baseData.content = sourceFeedback?.content || adminFeedback || 'Changes requested';
        baseData.reasons = sourceFeedback?.reasons || [];
        baseData.type = sourceFeedback?.type || 'REQUEST';
      } else if (mediaType === 'photo') {
        baseData.photosToUpdate = [mediaId];
        const chosen = sourceFeedback?.photoContent || sourceFeedback?.content || adminFeedback || 'Changes requested';
        baseData.photoContent = chosen;
        baseData.content = chosen; // ensure generic content is set for creator UIs that read `content`
        baseData.reasons = sourceFeedback?.reasons || [];
        baseData.type = sourceFeedback?.type || 'REQUEST';
      } else if (mediaType === 'rawFootage') {
        baseData.rawFootageToUpdate = [mediaId];
        const chosen = sourceFeedback?.rawFootageContent || sourceFeedback?.content || adminFeedback || 'Changes requested';
        baseData.rawFootageContent = chosen;
        baseData.content = chosen; // ensure generic content is set for creator UIs that read `content`
        baseData.reasons = sourceFeedback?.reasons || [];
        baseData.type = sourceFeedback?.type || 'REQUEST';
      }

      console.log('📝  [forwardClientFeedbackV3] creating creator-visible media feedback:', {
        submissionId,
        mediaType,
        mediaId,
        feedbackId,
        chosenContent: baseData.content,
        reasons: baseData.reasons,
        type: baseData.type,
      });
      const created = await prisma.feedback.create({ data: baseData });
      console.log('✅  [forwardClientFeedbackV3] created feedback id:', created.id);
      createdFeedback = created;
    } else if (adminFeedback) {
      // Fallback: if no media provided, store a general comment for the submission
      console.log('📝  [forwardClientFeedbackV3] creating creator-visible general feedback');
      const created = await prisma.feedback.create({
        data: {
          content: adminFeedback,
          type: 'COMMENT',
          adminId: adminId,
          submissionId: submissionId,
          sentToCreator: true,
        },
      });
      console.log('✅  [forwardClientFeedbackV3] created general feedback id:', created.id);
      createdFeedback = created;
    }

    // Update specific media status from CLIENT_FEEDBACK to REVISION_REQUESTED
    if (mediaId && mediaType) {
      switch (mediaType) {
        case 'video':
          await prisma.video.update({
            where: { id: mediaId },
            data: { status: 'REVISION_REQUESTED' }
          });
          break;
        case 'photo':
          await prisma.photo.update({
            where: { id: mediaId },
            data: { status: 'REVISION_REQUESTED' }
          });
          break;
        case 'rawFootage':
          await prisma.rawFootage.update({
            where: { id: mediaId },
            data: { status: 'REVISION_REQUESTED' }
          });
          break;
      }
      console.log(`Media ${mediaType} ${mediaId} status updated from CLIENT_FEEDBACK to REVISION_REQUESTED`);
    
    // Log the current status of all media items for debugging
    const debugMedia = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        video: { select: { id: true, status: true } },
        photos: { select: { id: true, status: true } },
        rawFootages: { select: { id: true, status: true } },
      }
    });
    
    console.log('ℹ️  [forwardClientFeedbackV3] Media statuses after update:', {
      videos: debugMedia?.video.map(v => ({ id: v.id, status: v.status })),
      photos: debugMedia?.photos.map(p => ({ id: p.id, status: p.status })),
      rawFootages: debugMedia?.rawFootages.map(r => ({ id: r.id, status: r.status }))
    });
    }



    // Check if all revision-requested media items have been sent to creator
    const allMedia = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        video: true,
        photos: true,
        rawFootages: true,
      }
    });

    // Count only CLIENT_FEEDBACK items that still need to be processed
    // REVISION_REQUESTED items have already been sent to creator
    const pendingVideos = allMedia?.video.filter(v => v.status === 'CLIENT_FEEDBACK').length || 0;
    const pendingPhotos = allMedia?.photos.filter(p => p.status === 'CLIENT_FEEDBACK').length || 0;
    const pendingRawFootages = allMedia?.rawFootages.filter(r => r.status === 'CLIENT_FEEDBACK').length || 0;

    const totalPending = pendingVideos + pendingPhotos + pendingRawFootages;

    console.log(`Status check after forwarding: videos=${pendingVideos}, photos=${pendingPhotos}, rawFootages=${pendingRawFootages}, total=${totalPending}`);
    console.log(`Submission current status: ${submission.status}, will update to CHANGES_REQUIRED: ${totalPending === 0}`);

    // Update submission status to CHANGES_REQUIRED only when ALL items have been processed
    if (totalPending === 0) {
      await prisma.submission.update({
        where: { id: submissionId },
        data: { status: 'CHANGES_REQUIRED' }
      });
      console.log(`Submission ${submissionId} status updated to CHANGES_REQUIRED after all items processed.`);
    } else {
      console.log(`Submission ${submissionId} status kept as ${submission.status} - ${totalPending} items still pending.`);
    }

    // Create notification for creator
    await prisma.notification.create({
        data: {
        title: 'Changes Required',
        message: `Changes have been requested for your ${submission.submissionType.type.toLowerCase().replace('_', ' ')} in campaign "${submission.campaign.name}".`,
        entity: 'Draft',
        campaignId: submission.campaignId,
        userId: submission.userId
      }
    });

    return res.status(200).json({ message: 'Client feedback forwarded to creator', feedback: createdFeedback });

  } catch (error) {
    console.error('Error forwarding client feedback V3:', error);
    return res.status(500).json({ message: 'Failed to forward feedback' });
  }
};

// V3: Admin reviews and forwards client feedback (alias for forwardClientFeedbackV3)
export const reviewAndForwardClientFeedbackV3 = async (req: Request, res: Response) => {
  return forwardClientFeedbackV3(req, res);
};

// GET: Return creator-visible feedback for a final draft (based on dependency chain)
export const getCreatorVisibleFeedbackV3 = async (req: Request, res: Response) => {
  const { submissionId } = req.params;
  try {
    // Find dependency row for this (final draft) submission
    const dependency = await prisma.submissionDependency.findFirst({
      where: { submissionId },
      select: { dependentSubmissionId: true }
    });
    const firstDraftId = dependency?.dependentSubmissionId;
    if (!firstDraftId) return res.status(200).json({ feedback: [] });

    const feedback = await prisma.feedback.findMany({
      where: {
        submissionId: firstDraftId,
        sentToCreator: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.status(200).json({ feedback });
  } catch (error) {
    console.error('Error fetching creator-visible feedback:', error);
    return res.status(500).json({ message: 'Failed to fetch creator-visible feedback' });
  }
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

    console.log(`🔍 Admin request changes - Status updated to CHANGES_REQUIRED for submission ${submissionId}`);

    // Verify the status was updated
    const updatedSubmission = await prisma.submission.findUnique({
      where: { id: submissionId },
      select: { status: true }
    });
    console.log(`🔍 Admin request changes - Verified status after update: ${updatedSubmission?.status}`);

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

// Allow admins to update an existing feedback's content (V3)
export const updateFeedbackV3 = async (req: Request, res: Response) => {
  const { feedbackId } = req.params as any;
  const { content } = req.body as any;
  const adminId = req.session.userid;

  try {
    if (!content || typeof content !== 'string') {
      return res.status(400).json({ message: 'Content is required' });
    }

    const existing = await prisma.feedback.findUnique({
      where: { id: feedbackId },
      include: {
        submission: {
          include: { campaign: true }
        }
      }
    });

    if (!existing) {
      return res.status(404).json({ message: 'Feedback not found' });
    }

    if (existing.submission.campaign.origin !== 'CLIENT') {
      return res.status(400).json({ message: 'This endpoint is only for client-created campaigns' });
    }

    // Update generic content, and media-specific fields so both are in sync
    const updateData: any = { content };
    if ((existing.photosToUpdate?.length || 0) > 0) {
      updateData.photoContent = content;
    }
    if ((existing.rawFootageToUpdate?.length || 0) > 0) {
      updateData.rawFootageContent = content;
    }

    await prisma.feedback.update({ where: { id: feedbackId }, data: updateData });

    // Return the updated feedback for immediate UI updates on both sides
    const updated = await prisma.feedback.findUnique({ where: { id: feedbackId } });

    console.log(`Admin ${adminId} updated feedback ${feedbackId}`);
    return res.status(200).json({ message: 'Feedback updated', feedback: updated });
  } catch (error) {
    console.error('Error updating feedback V3:', error);
    return res.status(500).json({ message: 'Failed to update feedback' });
  }
};
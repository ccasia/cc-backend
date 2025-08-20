import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { 
  createV4SubmissionsForCreator, 
  getV4Submissions, 
  updatePostingLink, 
  submitV4Content
} from '../services/submissionV4Service';
import { V4SubmissionCreateData, PostingLinkUpdate, V4ContentSubmission } from '../types/submissionV4Types';

const prisma = new PrismaClient();

/**
 * Create V4 submissions when creator is approved
 * POST /api/submissions/v4/create
 */
export const createV4Submissions = async (req: Request, res: Response) => {
  const { campaignId, userId, ugcVideos, rawFootage, photos } = req.body as V4SubmissionCreateData;
  
  try {
    // Validate required fields
    if (!campaignId || !userId || ugcVideos === undefined) {
      return res.status(400).json({
        message: 'Missing required fields: campaignId, userId, ugcVideos'
      });
    }
    
    // Verify this is a v4 campaign
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId }
    });
    
    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found' });
    }
    
    if (campaign.submissionVersion !== 'v4') {
      return res.status(400).json({ 
        message: 'This endpoint is only for v4 campaigns' 
      });
    }
    
    // Check if submissions already exist for this creator
    const existingSubmissions = await prisma.submission.findFirst({
      where: {
        campaignId,
        userId,
        submissionVersion: 'v4'
      }
    });
    
    if (existingSubmissions) {
      return res.status(409).json({
        message: 'V4 submissions already exist for this creator'
      });
    }
    
    // Create the submissions
    const result = await createV4SubmissionsForCreator({
      campaignId,
      userId,
      ugcVideos: ugcVideos || 0,
      rawFootage: rawFootage || 0,
      photos: photos || false
    });
    
    // Get the created submissions with full data
    const submissions = await getV4Submissions(campaignId, userId);
    
    console.log(`✅ Created ${result.count} v4 submissions for creator ${userId} in campaign ${campaignId}`);
    
    res.status(201).json({
      message: 'V4 submissions created successfully',
      count: result.count,
      submissions
    });
    
  } catch (error) {
    console.error('Error creating v4 submissions:', error);
    res.status(500).json({
      message: 'Failed to create v4 submissions',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

/**
 * Get V4 submissions for a campaign
 * GET /api/submissions/v4/submissions?campaignId=xxx&userId=xxx
 */
export const getV4SubmissionsController = async (req: Request, res: Response) => {
  const { campaignId, userId } = req.query;
  
  try {
    if (!campaignId) {
      return res.status(400).json({ message: 'campaignId is required' });
    }
    
    const submissions = await getV4Submissions(
      campaignId as string, 
      userId as string | undefined
    );
    
    // Group submissions by type for easier frontend consumption
    const groupedSubmissions = {
      agreement: submissions.find(s => s.submissionType.type === 'AGREEMENT_FORM'),
      videos: submissions.filter(s => s.submissionType.type === 'VIDEO'),
      photos: submissions.filter(s => s.submissionType.type === 'PHOTO'),
      rawFootage: submissions.filter(s => s.submissionType.type === 'RAW_FOOTAGE')
    };
    
    console.log(`🔍 Found ${submissions.length} v4 submissions for campaign ${campaignId}`);
    
    res.status(200).json({
      submissions,
      grouped: groupedSubmissions,
      total: submissions.length
    });
    
  } catch (error) {
    console.error('Error getting v4 submissions:', error);
    res.status(500).json({
      message: 'Failed to get v4 submissions',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

/**
 * Submit content for a V4 submission
 * POST /api/submissions/v4/submit-content
 */
export const submitV4ContentController = async (req: Request, res: Response) => {
  const { submissionId, videoUrls, photoUrls, rawFootageUrls, caption } = req.body as V4ContentSubmission;
  
  try {
    if (!submissionId) {
      return res.status(400).json({ message: 'submissionId is required' });
    }
    
    const result = await submitV4Content(submissionId, {
      videoUrls,
      photoUrls,
      rawFootageUrls,
      caption
    });
    
    console.log(`📤 Content submitted for v4 submission ${submissionId}`);
    
    res.status(200).json({
      message: 'Content submitted successfully',
      submission: result
    });
    
  } catch (error) {
    console.error('Error submitting v4 content:', error);
    res.status(500).json({
      message: 'Failed to submit content',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

/**
 * Approve/Reject V4 submission content
 * POST /api/submissions/v4/approve
 */
export const approveV4Submission = async (req: Request, res: Response) => {
  const { submissionId, action, feedback, reasons } = req.body;
  const currentUserId = req.session.userid;
  
  try {
    if (!submissionId || !action) {
      return res.status(400).json({ 
        message: 'submissionId and action are required' 
      });
    }
    
    if (!['approve', 'reject', 'request_revision'].includes(action)) {
      return res.status(400).json({ 
        message: 'action must be approve, reject, or request_revision' 
      });
    }
    
    // Get submission with content and campaign info
    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        submissionType: true,
        campaign: {
          select: {
            id: true,
            origin: true
          }
        },
        video: true,
        photos: true,
        rawFootages: true
      }
    });
    
    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }
    
    if (submission.submissionVersion !== 'v4') {
      return res.status(400).json({ message: 'Not a v4 submission' });
    }
    
    // Determine submission status based on campaign origin and action
    let newStatus: string;
    let contentStatus: string;
    
    switch (action) {
      case 'approve':
        // For client-created campaigns, admin approval sends to client first
        if (submission.campaign.origin === 'CLIENT') {
          newStatus = 'SENT_TO_CLIENT';
          contentStatus = 'SENT_TO_CLIENT';
        } else {
          // For admin-created campaigns, direct approval
          newStatus = 'APPROVED';
          contentStatus = 'APPROVED';
        }
        break;
      case 'reject':
        newStatus = 'REJECTED';
        contentStatus = 'REJECTED';
        break;
      case 'request_revision':
        newStatus = 'CHANGES_REQUIRED';
        contentStatus = 'REVISION_REQUESTED';
        break;
      default:
        newStatus = 'PENDING_REVIEW';
        contentStatus = 'PENDING';
    }
    
    // Update submission and individual content items
    const updates = [];
    
    // Update submission status
    updates.push(
      prisma.submission.update({
        where: { id: submissionId },
        data: {
          status: newStatus as any,
          updatedAt: new Date()
        }
      })
    );
    
    // contentStatus already determined above based on campaign origin
    
    // Update videos
    if (submission.video && submission.video.length > 0) {
      updates.push(
        prisma.video.updateMany({
          where: { submissionId },
          data: {
            status: contentStatus as any,
            feedback: feedback,
            reasons: reasons || [],
            adminId: currentUserId,
            feedbackAt: new Date()
          }
        })
      );
    }
    
    // Update photos
    if (submission.photos && submission.photos.length > 0) {
      updates.push(
        prisma.photo.updateMany({
          where: { submissionId },
          data: {
            status: contentStatus as any,
            feedback: feedback,
            reasons: reasons || [],
            adminId: currentUserId,
            feedbackAt: new Date()
          }
        })
      );
    }
    
    // Update raw footage
    if (submission.rawFootages && submission.rawFootages.length > 0) {
      updates.push(
        prisma.rawFootage.updateMany({
          where: { submissionId },
          data: {
            status: contentStatus as any,
            feedback: feedback,
            reasons: reasons || [],
            adminId: currentUserId,
            feedbackAt: new Date()
          }
        })
      );
    }
    
    // Add overall feedback record
    if (feedback) {
      updates.push(
        prisma.feedback.create({
          data: {
            content: feedback,
            reasons: reasons || [],
            submissionId,
            adminId: currentUserId,
            type: 'COMMENT'
          }
        })
      );
    }
    
    // Execute all updates
    await prisma.$transaction(updates);
    
    // Note: Content submissions are created when agreements are approved in the main submission workflow
    // This controller only handles the actual content submissions (VIDEO, PHOTO, RAW_FOOTAGE)
    
    const actionMessage = submission.campaign.origin === 'CLIENT' && action === 'approve' 
      ? 'approved and sent to client for review'
      : `${action}d successfully`;
    
    console.log(`✅ V4 submission ${submissionId} ${actionMessage} by admin ${currentUserId}`);
    
    res.status(200).json({
      message: `Submission ${actionMessage}`,
      submissionId,
      newStatus
    });
    
  } catch (error) {
    console.error('Error approving v4 submission:', error);
    res.status(500).json({
      message: 'Failed to update submission',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

/**
 * Client approve/reject V4 submission content
 * POST /api/submissions/v4/approve/client
 */
export const approveV4SubmissionByClient = async (req: Request, res: Response) => {
  const { submissionId, action, feedback, reasons } = req.body;
  const clientId = req.session.userid;
  
  try {
    if (!submissionId || !action) {
      return res.status(400).json({ 
        message: 'submissionId and action are required' 
      });
    }
    
    if (!['approve', 'request_changes'].includes(action)) {
      return res.status(400).json({ 
        message: 'action must be approve or request_changes' 
      });
    }
    
    // Get submission with content and campaign info
    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        submissionType: true,
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
        rawFootages: true
      }
    });
    
    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }
    
    if (submission.submissionVersion !== 'v4') {
      return res.status(400).json({ message: 'Not a v4 submission' });
    }
    
    // Verify this is a client-created campaign
    if (submission.campaign.origin !== 'CLIENT') {
      return res.status(400).json({ message: 'This endpoint is only for client-created campaigns' });
    }
    
    // Verify client has access to this campaign
    const clientAccess = submission.campaign.campaignAdmin.find(ca => 
      ca.admin.userId === clientId && ca.admin.user.role === 'client'
    );
    
    if (!clientAccess) {
      return res.status(403).json({ message: 'You do not have access to this campaign' });
    }
    
    // Verify submission is in correct status (sent to client)
    if (submission.status !== 'SENT_TO_CLIENT') {
      return res.status(400).json({ 
        message: `Cannot ${action} submission. Current status: ${submission.status}` 
      });
    }
    
    // Determine new statuses
    let newSubmissionStatus: string;
    let newContentStatus: string;
    
    switch (action) {
      case 'approve':
        newSubmissionStatus = 'APPROVED';
        newContentStatus = 'CLIENT_APPROVED';
        break;
      case 'request_changes':
        newSubmissionStatus = 'CLIENT_FEEDBACK';
        newContentStatus = 'CLIENT_FEEDBACK';
        break;
      default:
        newSubmissionStatus = 'SENT_TO_CLIENT';
        newContentStatus = 'SENT_TO_CLIENT';
    }
    
    // Update submission and individual content items
    const updates = [];
    
    // Update submission status
    updates.push(
      prisma.submission.update({
        where: { id: submissionId },
        data: {
          status: newSubmissionStatus as any,
          updatedAt: new Date()
        }
      })
    );
    
    // Update videos
    if (submission.video && submission.video.length > 0) {
      updates.push(
        prisma.video.updateMany({
          where: { submissionId },
          data: {
            status: newContentStatus as any,
            feedback: feedback || null,
            reasons: reasons || []
            // Note: clientId and clientFeedbackAt fields would need to be added to schema
          }
        })
      );
    }
    
    // Update photos
    if (submission.photos && submission.photos.length > 0) {
      updates.push(
        prisma.photo.updateMany({
          where: { submissionId },
          data: {
            status: newContentStatus as any,
            feedback: feedback || null,
            reasons: reasons || []
            // Note: clientId and clientFeedbackAt fields would need to be added to schema
          }
        })
      );
    }
    
    // Update raw footages
    if (submission.rawFootages && submission.rawFootages.length > 0) {
      updates.push(
        prisma.rawFootage.updateMany({
          where: { submissionId },
          data: {
            status: newContentStatus as any,
            feedback: feedback || null,
            reasons: reasons || []
            // Note: clientId and clientFeedbackAt fields would need to be added to schema
          }
        })
      );
    }
    
    // Add client feedback record if provided
    if (feedback) {
      updates.push(
        prisma.feedback.create({
          data: {
            content: feedback,
            reasons: reasons || [],
            submissionId,
            adminId: clientId,
            type: 'COMMENT' // Using existing enum value, CLIENT_COMMENT would need to be added
          }
        })
      );
    }
    
    // Execute all updates
    await prisma.$transaction(updates);
    
    console.log(`✅ V4 submission ${submissionId} ${action}d by client ${clientId}`);
    
    res.status(200).json({
      message: `Submission ${action}d by client successfully`,
      submissionId,
      newStatus: newSubmissionStatus
    });
    
  } catch (error) {
    console.error('Error processing client v4 submission:', error);
    res.status(500).json({
      message: 'Failed to process client decision',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

/**
 * Admin forward client feedback to creator
 * POST /api/submissions/v4/forward-client-feedback
 */
export const forwardClientFeedbackV4 = async (req: Request, res: Response) => {
  const { submissionId, adminFeedback } = req.body;
  const adminId = req.session.userid;
  
  try {
    if (!submissionId) {
      return res.status(400).json({ message: 'submissionId is required' });
    }
    
    // Get submission with client feedback
    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        submissionType: true,
        campaign: true,
        video: true,
        photos: true,
        rawFootages: true,
        feedback: {
          where: { type: 'COMMENT' }, // Using existing enum, would filter by clientId in practice
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      }
    });
    
    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }
    
    if (submission.submissionVersion !== 'v4') {
      return res.status(400).json({ message: 'Not a v4 submission' });
    }
    
    // Verify submission has client feedback to forward
    if (submission.status !== 'CLIENT_FEEDBACK') {
      return res.status(400).json({ 
        message: `Cannot forward feedback. Current status: ${submission.status}` 
      });
    }
    
    // Update submission and content to changes required
    const updates = [];
    
    // Update submission status to changes required
    updates.push(
      prisma.submission.update({
        where: { id: submissionId },
        data: {
          status: 'CHANGES_REQUIRED',
          updatedAt: new Date()
        }
      })
    );
    
    // Update individual content items
    const contentStatus = 'REVISION_REQUESTED';
    
    if (submission.video && submission.video.length > 0) {
      updates.push(
        prisma.video.updateMany({
          where: { submissionId },
          data: {
            status: contentStatus as any,
            adminId: adminId,
            feedbackAt: new Date()
          }
        })
      );
    }
    
    if (submission.photos && submission.photos.length > 0) {
      updates.push(
        prisma.photo.updateMany({
          where: { submissionId },
          data: {
            status: contentStatus as any,
            adminId: adminId,
            feedbackAt: new Date()
          }
        })
      );
    }
    
    if (submission.rawFootages && submission.rawFootages.length > 0) {
      updates.push(
        prisma.rawFootage.updateMany({
          where: { submissionId },
          data: {
            status: contentStatus as any,
            adminId: adminId,
            feedbackAt: new Date()
          }
        })
      );
    }
    
    // Add admin's forwarding feedback if provided
    if (adminFeedback) {
      updates.push(
        prisma.feedback.create({
          data: {
            content: adminFeedback,
            type: 'COMMENT', // Using existing enum value, ADMIN_COMMENT would need to be added
            adminId: adminId,
            submissionId
          }
        })
      );
    }
    
    // Execute all updates
    await prisma.$transaction(updates);
    
    console.log(`✅ V4 submission ${submissionId} client feedback forwarded by admin ${adminId}`);
    
    res.status(200).json({
      message: 'Client feedback forwarded to creator successfully',
      submissionId,
      newStatus: 'CHANGES_REQUIRED'
    });
    
  } catch (error) {
    console.error('Error forwarding client feedback v4:', error);
    res.status(500).json({
      message: 'Failed to forward client feedback',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

/**
 * Update posting link for approved V4 submission
 * PUT /api/submissions/v4/posting-link
 */
export const updatePostingLinkController = async (req: Request, res: Response) => {
  const { submissionId, postingLink } = req.body as PostingLinkUpdate;
  
  try {
    if (!submissionId || !postingLink) {
      return res.status(400).json({ 
        message: 'submissionId and postingLink are required' 
      });
    }
    
    // Validate URL format
    try {
      new URL(postingLink);
    } catch {
      return res.status(400).json({ message: 'Invalid posting link URL' });
    }
    
    const result = await updatePostingLink(submissionId, postingLink);
    
    console.log(`🔗 Posting link updated for v4 submission ${submissionId}`);
    
    res.status(200).json({
      message: 'Posting link updated successfully',
      submission: result
    });
    
  } catch (error) {
    console.error('Error updating posting link:', error);
    
    if (error instanceof Error) {
      if (error.message.includes('not found')) {
        return res.status(404).json({ message: error.message });
      }
      if (error.message.includes('must be approved')) {
        return res.status(400).json({ message: error.message });
      }
      if (error.message.includes('Not a v4')) {
        return res.status(400).json({ message: error.message });
      }
    }
    
    res.status(500).json({
      message: 'Failed to update posting link',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

/**
 * Get single V4 submission by ID
 * GET /api/submissions/v4/submission/:id
 */
export const getV4SubmissionById = async (req: Request, res: Response) => {
  const { id } = req.params;
  
  try {
    const submission = await prisma.submission.findUnique({
      where: { id },
      include: {
        submissionType: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        campaign: {
          select: {
            id: true,
            name: true
          }
        },
        video: {
          select: {
            id: true,
            url: true,
            status: true,
            feedback: true,
            reasons: true,
            feedbackAt: true
          }
        },
        photos: {
          select: {
            id: true,
            url: true,
            status: true,
            feedback: true,
            reasons: true,
            feedbackAt: true
          }
        },
        rawFootages: {
          select: {
            id: true,
            url: true,
            status: true,
            feedback: true,
            reasons: true,
            feedbackAt: true
          }
        },
        feedback: {
          include: {
            admin: {
              select: {
                id: true,
                name: true
              }
            }
          },
          orderBy: {
            createdAt: 'desc'
          }
        }
      }
    });
    
    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }
    
    if (submission.submissionVersion !== 'v4') {
      return res.status(400).json({ message: 'Not a v4 submission' });
    }
    
    res.status(200).json({ submission });
    
  } catch (error) {
    console.error('Error getting v4 submission by ID:', error);
    res.status(500).json({
      message: 'Failed to get submission',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};
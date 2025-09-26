import { Request, Response } from 'express';
import { FeedbackStatus, PrismaClient, SubmissionStatus } from '@prisma/client';
import { 
  createV4SubmissionsForCreator, 
  getV4Submissions, 
  updatePostingLink, 
  submitV4Content
} from '../service/submissionV4Service';
import { V4SubmissionCreateData, PostingLinkUpdate, V4ContentSubmission } from '../types/submissionV4Types';
import { 
  getNextStatusAfterAdminAction, 
  getNextStatusAfterClientAction,
  getStatusAfterForwardingClientFeedback
} from '../utils/v4StatusUtils';
import { checkAndCompleteV4Campaign } from '../service/submissionV4CompletionService';

/**
 * Update submission status based on individual content statuses
 * For photo and raw footage submissions, if any content needs revision, 
 * the submission should allow creator to re-upload
 */
const updateSubmissionStatusBasedOnContent = async (submissionId: string) => {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: {
      submissionType: true,
      campaign: true,
      photos: true,
      rawFootages: true,
      video: true
    }
  });

  if (!submission) return;

  // Only update status for photo and raw footage submissions
  const isPhotoSubmission = submission.submissionType.type === 'PHOTO';
  const isRawFootageSubmission = submission.submissionType.type === 'RAW_FOOTAGE';
  
  if (!isPhotoSubmission && !isRawFootageSubmission) return;

  let hasRevisionRequested = false;
  let hasApproved = false;
  let hasClientFeedback = false;
  let hasSentToClient = false;
  let allProcessed = true;

  // Check photo statuses
  if (isPhotoSubmission && submission.photos?.length > 0) {
    submission.photos.forEach(photo => {
      if (['REVISION_REQUESTED', 'REJECTED'].includes(photo.status)) {
        hasRevisionRequested = true;
      } else if (photo.status === 'APPROVED') {
        hasApproved = true;
      } else if (photo.status === 'SENT_TO_CLIENT') {
        hasSentToClient = true;
      } else if (photo.status === 'CLIENT_FEEDBACK') {
        hasClientFeedback = true;
      } else if (['PENDING', 'PENDING_REVIEW'].includes(photo.status)) {
        allProcessed = false;
      }
    });
  }

  // Check raw footage statuses
  if (isRawFootageSubmission && submission.rawFootages?.length > 0) {
    submission.rawFootages.forEach(rawFootage => {
      if (['REVISION_REQUESTED', 'REJECTED'].includes(rawFootage.status)) {
        hasRevisionRequested = true;
      } else if (rawFootage.status === 'APPROVED') {
        hasApproved = true;
      } else if (rawFootage.status === 'SENT_TO_CLIENT') {
        hasSentToClient = true;
      } else if (rawFootage.status === 'CLIENT_FEEDBACK') {
        hasClientFeedback = true;
      } else if (['PENDING', 'PENDING_REVIEW'].includes(rawFootage.status)) {
        allProcessed = false;
      }
    });
  }

  // Determine new submission status
  let newSubmissionStatus = submission.status;

  if (hasRevisionRequested && !hasClientFeedback) {
    // If any content needs revision AND no content has client feedback, allow creator to re-upload
    newSubmissionStatus = 'CHANGES_REQUIRED';
  } else if (hasClientFeedback && allProcessed) {
    // If any content has client feedback, admin needs to forward it
    newSubmissionStatus = 'CLIENT_FEEDBACK';
  } else if ((hasApproved || hasSentToClient) && allProcessed) {
    // Check what the final status should be based on content statuses
    const isClientCampaign = submission.campaign?.origin === 'CLIENT';
    
    if (isClientCampaign) {
      // For client campaigns
      const allContentApproved = isPhotoSubmission 
        ? submission.photos?.every(p => p.status === 'APPROVED')
        : submission.rawFootages?.every(r => r.status === 'APPROVED');
      
      const allContentSentToClient = isPhotoSubmission 
        ? submission.photos?.every(p => p.status === 'SENT_TO_CLIENT')
        : submission.rawFootages?.every(r => r.status === 'SENT_TO_CLIENT');
      
      if (allContentApproved) {
        // All content is fully approved by client - final approval state
        newSubmissionStatus = 'CLIENT_APPROVED';
      } else if (allContentSentToClient) {
        // All content has been sent to client for review
        newSubmissionStatus = 'SENT_TO_CLIENT';
      } else {
        // Mixed statuses - check what the majority status should be
        const hasAnyApproved = isPhotoSubmission 
          ? submission.photos?.some(p => p.status === 'APPROVED')
          : submission.rawFootages?.some(r => r.status === 'APPROVED');
        
        const hasAnySentToClient = isPhotoSubmission 
          ? submission.photos?.some(p => p.status === 'SENT_TO_CLIENT')
          : submission.rawFootages?.some(r => r.status === 'SENT_TO_CLIENT');
        
        if (hasAnySentToClient && !hasAnyApproved) {
          // All content is either sent to client or in review - keep as sent to client
          newSubmissionStatus = 'SENT_TO_CLIENT';
        } else if (hasAnyApproved && !hasAnySentToClient) {
          // Some content approved by client but not all - this shouldn't happen but handle gracefully
          newSubmissionStatus = 'SENT_TO_CLIENT';
        } else {
          // Mixed approved and sent to client - still waiting for all to be approved
          newSubmissionStatus = 'SENT_TO_CLIENT';
        }
      }
    } else {
      // For regular campaigns, mark as approved when all content is approved
      const allContentApproved = isPhotoSubmission 
        ? submission.photos?.every(p => p.status === 'APPROVED')
        : submission.rawFootages?.every(r => r.status === 'APPROVED');
      
      if (allContentApproved) {
        newSubmissionStatus = 'APPROVED';
      }
    }
  } else if (allProcessed && !hasRevisionRequested && !hasApproved && !hasSentToClient) {
    // If all processed but none approved or rejected, keep in review
    newSubmissionStatus = 'PENDING_REVIEW';
  }

  // Update submission status if it changed
  if (newSubmissionStatus !== submission.status) {
    await prisma.submission.update({
      where: { id: submissionId },
      data: { status: newSubmissionStatus as any }
    });
    
    console.log(`📝 Updated submission ${submissionId} status from ${submission.status} to ${newSubmissionStatus}`);
  }
};

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
    
    // Emit socket event for real-time updates
    const io = req.app.get('io');
    if (io) {
      io.to(campaignId).emit('v4:submissions:created', {
        campaignId,
        userId,
        count: result.count,
        submissions,
        createdAt: new Date().toISOString()
      });
    }
    
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
    
    // Emit socket event for real-time updates
    const io = req.app.get('io');
    if (io) {
      // Get campaign ID for socket room
      const submission = await prisma.submission.findUnique({
        where: { id: submissionId },
        select: { campaign: { select: { id: true } } }
      });
      
      if (submission) {
        io.to(submission.campaign.id).emit('v4:content:submitted', {
          submissionId,
          campaignId: submission.campaign.id,
          hasVideo: videoUrls && videoUrls.length > 0,
          hasPhotos: photoUrls && photoUrls.length > 0,
          hasRawFootage: rawFootageUrls && rawFootageUrls.length > 0,
          submittedAt: new Date().toISOString()
        });
      }
    }
    
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
  const { submissionId, action, feedback, reasons, caption } = req.body;
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
    
    // Use status utilities to determine next status
    const { submissionStatus: newStatus, videoStatus: contentStatus } = getNextStatusAfterAdminAction(
      action as any,
      submission.campaign.origin as any
    );
    
    // Update submission and individual content items
    const updates = [];
    
    // Update submission status and caption if provided
    const updateData: any = {
      status: newStatus as any,
      updatedAt: new Date()
    };
    
    // Update caption if provided (only for admin actions)
    if (caption !== undefined) {
      updateData.caption = caption || null;
    }
    
    updates.push(
      prisma.submission.update({
        where: { id: submissionId },
        data: updateData
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
    
    // Always add feedback record to maintain consistent display
    // Determine feedback type based on action and campaign origin
    let feedbackType: 'REQUEST' | 'COMMENT' = 'COMMENT';
    
    if (action === 'request_revision' || action === 'reject') {
      // Admin requesting changes = REQUEST type
      feedbackType = 'REQUEST';
    } else if (action === 'approve' && submission.campaign.origin === 'CLIENT') {
      // Send to Client = COMMENT type
      feedbackType = 'COMMENT';
    }
    
    updates.push(
      prisma.feedback.create({
        data: {
          content: feedback || '',
          reasons: reasons || [],
          submissionId,
          adminId: currentUserId,
          type: feedbackType,
          sentToCreator: action !== 'approve' // Set to true for reject and request_revision
        }
      })
    );
    
    // Execute all updates
    await prisma.$transaction(updates);
    
    // Emit socket event for real-time updates
    const io = req.app.get('io');
    if (io) {
      io.to(submission.campaign.id).emit('v4:submission:updated', {
        submissionId,
        campaignId: submission.campaign.id,
        newStatus,
        action,
        updatedAt: new Date().toISOString()
      });
    }
    
    // Note: Content submissions are created when agreements are approved in the main submission workflow
    // This controller only handles the actual content submissions (VIDEO, PHOTO, RAW_FOOTAGE)
    
    const actionMessage = submission.campaign.origin === 'CLIENT' && action === 'approve' 
      ? 'approved and sent to client for review'
      : `${action}d successfully`;
    
    console.log(`✅ V4 submission ${submissionId} ${actionMessage} by admin ${currentUserId}`);
    
    // Check if campaign is now complete and generate invoice if needed
    if (action === 'approve' && (newStatus === 'APPROVED' || newStatus === 'SENT_TO_CLIENT')) {
      try {
        await checkAndCompleteV4Campaign(submissionId, currentUserId);
      } catch (error) {
        console.error('Error checking campaign completion after submission approval by admin:', error);
        // Don't fail the request if completion check fails
      }
    }
    
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
    
    // Use status utilities to determine next status  
    const { submissionStatus: newSubmissionStatus, videoStatus: newContentStatus } = getNextStatusAfterClientAction(
      action as any
    );
    
    // Update submission and individual content items
    const updates = [];
    
    // Update submission status
    updates.push(
      prisma.submission.update({
        where: { id: submissionId },
        data: {
          status: newSubmissionStatus as SubmissionStatus
        }
      })
    );
    
    // Update videos
    if (submission.video && submission.video.length > 0) {
      updates.push(
        prisma.video.updateMany({
          where: { submissionId },
          data: {
            status: newContentStatus as FeedbackStatus,
            feedback: feedback || null,
            reasons: reasons || []
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
            status: newContentStatus as FeedbackStatus,
            feedback: feedback || null,
            reasons: reasons || []
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
            status: newContentStatus as FeedbackStatus,
            feedback: feedback || null,
            reasons: reasons || []
          }
        })
      );
    }
    
    // Always add client feedback record to maintain consistent display
    // Determine feedback type based on action
    const feedbackType = action === 'request_changes' ? 'REQUEST' : 'COMMENT';
    
    updates.push(
      prisma.feedback.create({
        data: {
          content: feedback || '',
          reasons: reasons || [],
          submissionId,
          adminId: clientId,
          sentToCreator: false, // Client feedback needs admin to forward
          type: feedbackType
        }
      })
    );
    
    // Execute all updates
    await prisma.$transaction(updates);
    
    // Emit socket event for real-time updates
    const io = req.app.get('io');
    if (io) {
      io.to(submission.campaign.id).emit('v4:submission:updated', {
        submissionId,
        campaignId: submission.campaign.id,
        newStatus: newSubmissionStatus,
        action,
        byClient: true,
        updatedAt: new Date().toISOString()
      });
    }
    
    console.log(`✅ V4 submission ${submissionId} ${action}d by client ${clientId}`);
    
    // Check if campaign is now complete and generate invoice if needed
    if (action === 'approve' && newSubmissionStatus === 'CLIENT_APPROVED') {
      try {
        await checkAndCompleteV4Campaign(submissionId, clientId);
      } catch (error) {
        console.error('Error checking campaign completion after client approval:', error);
        // Don't fail the request if completion check fails
      }
    }
    
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
    
    // Use status utilities to determine next status
    const { submissionStatus: newSubmissionStatus, videoStatus: contentStatus } = getStatusAfterForwardingClientFeedback();
    
    // Update submission and content to changes required
    const updates = [];
    
    // Update submission status to changes required
    updates.push(
      prisma.submission.update({
        where: { id: submissionId },
        data: {
          status: newSubmissionStatus,
          updatedAt: new Date()
        }
      })
    );
    
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
    
    // Update original client feedback to be visible to creator
    if (submission.feedback && submission.feedback.length > 0) {
      const latestClientFeedback = submission.feedback[0]; // Most recent feedback
      updates.push(
        prisma.feedback.update({
          where: { id: latestClientFeedback.id },
          data: {
            sentToCreator: true // Mark client feedback as sent to creator
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
            type: 'COMMENT', // Admin forwarding client feedback = COMMENT type
            adminId: adminId,
            submissionId,
            sentToCreator: true // Admin forwarded feedback is sent to creator
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
  const currentUserId = req.session.userid;
  
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
    
    const result = await updatePostingLink(submissionId, postingLink, currentUserId);
    
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
 * Admin approve/reject posting link for V4 submission
 * POST /api/submissions/v4/posting-link/approve
 */
export const approvePostingLinkV4 = async (req: Request, res: Response) => {
  const { submissionId, action } = req.body;
  const adminId = req.session.userid;
  
  try {
    if (!submissionId || !action) {
      return res.status(400).json({ 
        message: 'submissionId and action are required' 
      });
    }
    
    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ 
        message: 'action must be approve or reject' 
      });
    }
    
    // Get submission
    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        submissionType: true,
        campaign: {
          select: { campaignType: true }
        }
      }
    });
    
    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }
    
    if (submission.submissionVersion !== 'v4') {
      return res.status(400).json({ message: 'Not a v4 submission' });
    }
    
    // Check if campaign type allows posting links
    if (submission.campaign?.campaignType === 'ugc') {
      return res.status(400).json({ 
        message: 'Posting links are not required for UGC (No posting) campaigns' 
      });
    }
    
    // Check if submission has posting link to approve
    if (!submission.content) {
      return res.status(400).json({ 
        message: 'No posting link found to approve' 
      });
    }
    
    // Determine new status and content action
    let newStatus: string;
    let newContent: string | null;
    
    switch (action) {
      case 'approve':
        newStatus = 'POSTED';
        newContent = submission.content; // Keep the posting link
        break;
      case 'reject':
        newStatus = 'REJECTED'; // Requires changes
        newContent = null; // Clear the posting link
        break;
      default:
        newStatus = submission.status;
        newContent = submission.content;
    }
    
    // Update submission
    await prisma.submission.update({
      where: { id: submissionId },
      data: {
        status: newStatus as SubmissionStatus,
        content: newContent,
        updatedAt: new Date()
      }
    });
    
    // Emit socket event for real-time updates
    const io = req.app.get('io');
    if (io) {
      // Get campaign ID for socket room
      const submissionWithCampaign = await prisma.submission.findUnique({
        where: { id: submissionId },
        select: { campaign: { select: { id: true } } }
      });
      
      if (submissionWithCampaign) {
        io.to(submissionWithCampaign.campaign.id).emit('v4:submission:updated', {
          submissionId,
          campaignId: submissionWithCampaign.campaign.id,
          newStatus,
          action: `posting_link_${action}`,
          updatedAt: new Date().toISOString()
        });
      }
    }
    
    console.log(`✅ V4 submission ${submissionId} posting link ${action}d by admin ${adminId}`);
    
    // Check if campaign is now complete and generate invoice if needed
    if (action === 'approve' && newStatus === 'POSTED') {
      try {
        await checkAndCompleteV4Campaign(submissionId, adminId);
      } catch (error) {
        console.error('Error checking campaign completion after posting link approval:', error);
        // Don't fail the request if completion check fails
      }
    }
    
    res.status(200).json({
      message: `Posting link ${action}d successfully`,
      submissionId,
      newStatus
    });
    
  } catch (error) {
    console.error('Error approving posting link v4:', error);
    res.status(500).json({
      message: 'Failed to process posting link approval',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

/**
 * Admin approve individual content (video or raw footage)
 * PATCH /api/submissions/v4/content/approve
 */
export const approveIndividualContentV4 = async (req: Request, res: Response) => {
  const { contentType, contentId, feedback, reasons } = req.body;
  const adminId = req.session.userid;
  
  try {
    if (!contentType || !contentId) {
      return res.status(400).json({ 
        message: 'contentType and contentId are required' 
      });
    }
    
    if (!['video', 'rawFootage', 'photo'].includes(contentType)) {
      return res.status(400).json({ 
        message: 'contentType must be video, rawFootage, or photo' 
      });
    }
    
    let updatedContent;
    let submission;
    
    if (contentType === 'video') {
      // Get video and its submission
      const video = await prisma.video.findUnique({
        where: { id: contentId },
        include: { 
          submission: { 
            include: { campaign: true } 
          } 
        }
      });
      
      if (!video) {
        return res.status(404).json({ message: 'Video not found' });
      }
      
      submission = video.submission;
      
      if (!submission || submission.submissionVersion !== 'v4') {
        return res.status(400).json({ message: 'Not a v4 submission' });
      }
      
      // Determine status based on campaign origin
      const newStatus = submission.campaign.origin === 'CLIENT' ? 'SENT_TO_CLIENT' : 'APPROVED';
      
      // Update video
      updatedContent = await prisma.video.update({
        where: { id: contentId },
        data: {
          status: newStatus as any,
          feedback: feedback || null,
          reasons: reasons || [],
          adminId,
          feedbackAt: new Date()
        }
      });
    } else if (contentType === 'rawFootage') {
      // Handle raw footage
      const rawFootage = await prisma.rawFootage.findUnique({
        where: { id: contentId },
        include: { 
          submission: { 
            include: { campaign: true } 
          } 
        }
      });
      
      if (!rawFootage) {
        return res.status(404).json({ message: 'Raw footage not found' });
      }
      
      submission = rawFootage.submission;
      
      if (!submission || submission.submissionVersion !== 'v4') {
        return res.status(400).json({ message: 'Not a v4 submission' });
      }
      
      // Determine status based on campaign origin
      const newStatus = submission.campaign.origin === 'CLIENT' ? 'SENT_TO_CLIENT' : 'APPROVED';
      
      // Update raw footage
      updatedContent = await prisma.rawFootage.update({
        where: { id: contentId },
        data: {
          status: newStatus as any,
          feedback: feedback || null,
          reasons: reasons || [],
          adminId,
          feedbackAt: new Date()
        }
      });
    } else {
      // Handle photo
      const photo = await prisma.photo.findUnique({
        where: { id: contentId },
        include: { 
          submission: { 
            include: { campaign: true } 
          } 
        }
      });
      
      if (!photo) {
        return res.status(404).json({ message: 'Photo not found' });
      }
      
      submission = photo.submission;
      
      if (!submission || submission.submissionVersion !== 'v4') {
        return res.status(400).json({ message: 'Not a v4 submission' });
      }
      
      // Determine status based on campaign origin
      const newStatus = submission.campaign.origin === 'CLIENT' ? 'SENT_TO_CLIENT' : 'APPROVED';
      
      // Update photo
      updatedContent = await prisma.photo.update({
        where: { id: contentId },
        data: {
          status: newStatus as any,
          feedback: feedback || null,
          reasons: reasons || [],
          adminId,
          feedbackAt: new Date()
        }
      });
    }
    
    // Always add to submission-level feedback to maintain consistent display
    const feedbackData: any = {
      submissionId: submission.id,
      adminId,
      type: 'COMMENT', // Admin approving individual content = COMMENT type
      reasons: reasons || [],
      sentToCreator: false
    };
    
    if (contentType === 'video') {
      feedbackData.content = feedback || '';
      feedbackData.videosToUpdate = [contentId];
    } else if (contentType === 'rawFootage') {
      feedbackData.rawFootageContent = feedback || '';
      feedbackData.rawFootageToUpdate = [contentId];
    } else {
      feedbackData.photoContent = feedback || '';
      feedbackData.photosToUpdate = [contentId];
    }
    
    await prisma.feedback.create({ data: feedbackData });
    
    // Update submission status based on individual content statuses
    await updateSubmissionStatusBasedOnContent(submission.id);
    
    console.log(`✅ V4 ${contentType} ${contentId} approved by admin ${adminId}`);
    
    // Check if campaign is now complete and generate invoice if needed
    if (updatedContent.status === 'APPROVED' || updatedContent.status === 'SENT_TO_CLIENT') {
      try {
        await checkAndCompleteV4Campaign(submission.id, adminId);
      } catch (error) {
        console.error('Error checking campaign completion after individual content approval by admin:', error);
        // Don't fail the request if completion check fails
      }
    }
    
    res.status(200).json({
      message: `${contentType} approved successfully`,
      content: updatedContent,
      status: updatedContent.status
    });
    
  } catch (error) {
    console.error('Error approving individual content v4:', error);
    res.status(500).json({
      message: 'Failed to approve content',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

/**
 * Admin request changes for individual content (video or raw footage)
 * PATCH /api/submissions/v4/content/request-changes
 */
export const requestChangesIndividualContentV4 = async (req: Request, res: Response) => {
  const { contentType, contentId, feedback, reasons } = req.body;
  const adminId = req.session.userid;
  
  try {
    if (!contentType || !contentId || !feedback) {
      return res.status(400).json({ 
        message: 'contentType, contentId, and feedback are required' 
      });
    }
    
    if (!['video', 'rawFootage', 'photo'].includes(contentType)) {
      return res.status(400).json({ 
        message: 'contentType must be video, rawFootage, or photo' 
      });
    }
    
    let updatedContent;
    let submission;
    
    if (contentType === 'video') {
      // Get video and its submission
      const video = await prisma.video.findUnique({
        where: { id: contentId },
        include: { submission: true }
      });
      
      if (!video) {
        return res.status(404).json({ message: 'Video not found' });
      }
      
      submission = video.submission;
      
      if (!submission || submission.submissionVersion !== 'v4') {
        return res.status(400).json({ message: 'Not a v4 submission' });
      }
      
      // Update video
      updatedContent = await prisma.video.update({
        where: { id: contentId },
        data: {
          status: 'REVISION_REQUESTED',
          feedback,
          reasons: reasons || [],
          adminId,
          feedbackAt: new Date()
        }
      });
    } else if (contentType === 'rawFootage') {
      // Handle raw footage
      const rawFootage = await prisma.rawFootage.findUnique({
        where: { id: contentId },
        include: { submission: true }
      });
      
      if (!rawFootage) {
        return res.status(404).json({ message: 'Raw footage not found' });
      }
      
      submission = rawFootage.submission;
      
      if (!submission || submission.submissionVersion !== 'v4') {
        return res.status(400).json({ message: 'Not a v4 submission' });
      }
      
      // Update raw footage
      updatedContent = await prisma.rawFootage.update({
        where: { id: contentId },
        data: {
          status: 'REVISION_REQUESTED',
          feedback,
          reasons: reasons || [],
          adminId,
          feedbackAt: new Date()
        }
      });
    } else {
      // Handle photo
      const photo = await prisma.photo.findUnique({
        where: { id: contentId },
        include: { submission: true }
      });
      
      if (!photo) {
        return res.status(404).json({ message: 'Photo not found' });
      }
      
      submission = photo.submission;
      
      if (!submission || submission.submissionVersion !== 'v4') {
        return res.status(400).json({ message: 'Not a v4 submission' });
      }
      
      // Update photo
      updatedContent = await prisma.photo.update({
        where: { id: contentId },
        data: {
          status: 'REVISION_REQUESTED',
          feedback,
          reasons: reasons || [],
          adminId,
          feedbackAt: new Date()
        }
      });
    }
    
    // Add to submission-level feedback
    const feedbackData: any = {
      submissionId: submission.id,
      adminId,
      type: 'REQUEST', // Admin requesting changes = REQUEST type
      reasons: reasons || [],
      sentToCreator: true // Admin feedback is automatically sent to creator
    };
    
    if (contentType === 'video') {
      feedbackData.content = feedback;
      feedbackData.videosToUpdate = [contentId];
    } else if (contentType === 'rawFootage') {
      feedbackData.rawFootageContent = feedback;
      feedbackData.rawFootageToUpdate = [contentId];
    } else {
      feedbackData.photoContent = feedback;
      feedbackData.photosToUpdate = [contentId];
    }
    
    await prisma.feedback.create({ data: feedbackData });
    
    // Update submission status based on individual content statuses
    await updateSubmissionStatusBasedOnContent(submission.id);
    
    console.log(`✅ V4 ${contentType} ${contentId} changes requested by admin ${adminId}`);
    
    res.status(200).json({
      message: `Changes requested for ${contentType} successfully`,
      content: updatedContent,
      status: updatedContent.status
    });
    
  } catch (error) {
    console.error('Error requesting changes for individual content v4:', error);
    res.status(500).json({
      message: 'Failed to request changes',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

/**
 * Client approve individual content (video or raw footage)
 * PATCH /api/submissions/v4/content/approve/client
 */
export const approveIndividualContentByClientV4 = async (req: Request, res: Response) => {
  const { contentType, contentId, feedback } = req.body;
  const clientId = req.session.userid;
  
  try {
    if (!contentType || !contentId) {
      return res.status(400).json({ 
        message: 'contentType and contentId are required' 
      });
    }
    
    if (!['video', 'rawFootage', 'photo'].includes(contentType)) {
      return res.status(400).json({ 
        message: 'contentType must be video, rawFootage, or photo' 
      });
    }
    
    let updatedContent;
    let submission;
    
    if (contentType === 'video') {
      // Get video and its submission
      const video = await prisma.video.findUnique({
        where: { id: contentId },
        include: { 
          submission: { 
            include: { campaign: true } 
          } 
        }
      });
      
      if (!video) {
        return res.status(404).json({ message: 'Video not found' });
      }
      
      submission = video.submission;
      
      if (!submission || submission.submissionVersion !== 'v4') {
        return res.status(400).json({ message: 'Not a v4 submission' });
      }
      
      if (submission.campaign.origin !== 'CLIENT') {
        return res.status(400).json({ message: 'This endpoint is only for client-created campaigns' });
      }
      
      // Update video
      updatedContent = await prisma.video.update({
        where: { id: contentId },
        data: {
          status: 'APPROVED',
          feedback: feedback || null,
          adminId: clientId,
          feedbackAt: new Date()
        }
      });
    } else if (contentType === 'rawFootage') {
      // Handle raw footage
      const rawFootage = await prisma.rawFootage.findUnique({
        where: { id: contentId },
        include: { 
          submission: { 
            include: { campaign: true } 
          } 
        }
      });
      
      if (!rawFootage) {
        return res.status(404).json({ message: 'Raw footage not found' });
      }
      
      submission = rawFootage.submission;
      
      if (!submission || submission.submissionVersion !== 'v4') {
        return res.status(400).json({ message: 'Not a v4 submission' });
      }
      
      if (submission.campaign.origin !== 'CLIENT') {
        return res.status(400).json({ message: 'This endpoint is only for client-created campaigns' });
      }
      
      // Update raw footage
      updatedContent = await prisma.rawFootage.update({
        where: { id: contentId },
        data: {
          status: 'APPROVED',
          feedback: feedback || null,
          adminId: clientId,
          feedbackAt: new Date()
        }
      });
    } else {
      // Handle photo
      const photo = await prisma.photo.findUnique({
        where: { id: contentId },
        include: { 
          submission: { 
            include: { campaign: true } 
          } 
        }
      });
      
      if (!photo) {
        return res.status(404).json({ message: 'Photo not found' });
      }
      
      submission = photo.submission;
      
      if (!submission || submission.submissionVersion !== 'v4') {
        return res.status(400).json({ message: 'Not a v4 submission' });
      }
      
      if (submission.campaign.origin !== 'CLIENT') {
        return res.status(400).json({ message: 'This endpoint is only for client-created campaigns' });
      }
      
      // Update photo
      updatedContent = await prisma.photo.update({
        where: { id: contentId },
        data: {
          status: 'APPROVED',
          feedback: feedback || null,
          adminId: clientId,
          feedbackAt: new Date()
        }
      });
    }
    
    // Always add to submission-level feedback to maintain consistent display
    const feedbackData: any = {
      submissionId: submission.id,
      adminId: clientId,
      type: 'COMMENT', // Client approving individual content = COMMENT type
      sentToCreator: false // Client feedback needs admin to forward
    };
    
    if (contentType === 'video') {
      feedbackData.content = feedback || '';
      feedbackData.videosToUpdate = [contentId];
    } else if (contentType === 'rawFootage') {
      feedbackData.rawFootageContent = feedback || '';
      feedbackData.rawFootageToUpdate = [contentId];
    } else {
      feedbackData.photoContent = feedback || '';
      feedbackData.photosToUpdate = [contentId];
    }
    
    await prisma.feedback.create({ data: feedbackData });
    
    // Update submission status based on individual content statuses
    await updateSubmissionStatusBasedOnContent(submission.id);
    
    console.log(`✅ V4 ${contentType} ${contentId} approved by client ${clientId}`);
    
    // Check if campaign is now complete and generate invoice if needed
    if (updatedContent.status === 'APPROVED') {
      try {
        await checkAndCompleteV4Campaign(submission.id, clientId);
      } catch (error) {
        console.error('Error checking campaign completion after individual content approval:', error);
        // Don't fail the request if completion check fails
      }
    }
    
    res.status(200).json({
      message: `${contentType} approved by client successfully`,
      content: updatedContent,
      status: updatedContent.status
    });
    
  } catch (error) {
    console.error('Error approving individual content by client v4:', error);
    res.status(500).json({
      message: 'Failed to approve content',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

/**
 * Client request changes for individual content (video or raw footage)
 * PATCH /api/submissions/v4/content/request-changes/client
 */
export const requestChangesIndividualContentByClientV4 = async (req: Request, res: Response) => {
  const { contentType, contentId, feedback, reasons } = req.body;
  const clientId = req.session.userid;
  
  try {
    if (!contentType || !contentId || !feedback) {
      return res.status(400).json({ 
        message: 'contentType, contentId, and feedback are required' 
      });
    }
    
    if (!['video', 'rawFootage', 'photo'].includes(contentType)) {
      return res.status(400).json({ 
        message: 'contentType must be video, rawFootage, or photo' 
      });
    }
    
    let updatedContent;
    let submission;
    
    if (contentType === 'video') {
      // Get video and its submission
      const video = await prisma.video.findUnique({
        where: { id: contentId },
        include: { 
          submission: { 
            include: { campaign: true } 
          } 
        }
      });
      
      if (!video) {
        return res.status(404).json({ message: 'Video not found' });
      }
      
      submission = video.submission;
      
      if (!submission || submission.submissionVersion !== 'v4') {
        return res.status(400).json({ message: 'Not a v4 submission' });
      }
      
      if (submission.campaign.origin !== 'CLIENT') {
        return res.status(400).json({ message: 'This endpoint is only for client-created campaigns' });
      }
      
      // Update video
      updatedContent = await prisma.video.update({
        where: { id: contentId },
        data: {
          status: 'CLIENT_FEEDBACK',
          feedback,
          reasons: reasons || [],
          adminId: clientId,
          feedbackAt: new Date()
        }
      });
    } else if (contentType === 'rawFootage') {
      // Handle raw footage
      const rawFootage = await prisma.rawFootage.findUnique({
        where: { id: contentId },
        include: { 
          submission: { 
            include: { campaign: true } 
          } 
        }
      });
      
      if (!rawFootage) {
        return res.status(404).json({ message: 'Raw footage not found' });
      }
      
      submission = rawFootage.submission;
      
      if (!submission || submission.submissionVersion !== 'v4') {
        return res.status(400).json({ message: 'Not a v4 submission' });
      }
      
      if (submission.campaign.origin !== 'CLIENT') {
        return res.status(400).json({ message: 'This endpoint is only for client-created campaigns' });
      }
      
      // Update raw footage
      updatedContent = await prisma.rawFootage.update({
        where: { id: contentId },
        data: {
          status: 'CLIENT_FEEDBACK',
          feedback,
          reasons: reasons || [],
          adminId: clientId,
          feedbackAt: new Date()
        }
      });
    } else {
      // Handle photo
      const photo = await prisma.photo.findUnique({
        where: { id: contentId },
        include: { 
          submission: { 
            include: { campaign: true } 
          } 
        }
      });
      
      if (!photo) {
        return res.status(404).json({ message: 'Photo not found' });
      }
      
      submission = photo.submission;
      
      if (!submission || submission.submissionVersion !== 'v4') {
        return res.status(400).json({ message: 'Not a v4 submission' });
      }
      
      if (submission.campaign.origin !== 'CLIENT') {
        return res.status(400).json({ message: 'This endpoint is only for client-created campaigns' });
      }
      
      // Update photo
      updatedContent = await prisma.photo.update({
        where: { id: contentId },
        data: {
          status: 'CLIENT_FEEDBACK',
          feedback,
          reasons: reasons || [],
          adminId: clientId,
          feedbackAt: new Date()
        }
      });
    }
    
    // Add to submission-level feedback
    const feedbackData: any = {
      submissionId: submission.id,
      adminId: clientId,
      type: 'REQUEST', // Client requesting changes = REQUEST type
      reasons: reasons || [],
      sentToCreator: false // Client feedback needs admin to forward
    };
    
    if (contentType === 'video') {
      feedbackData.content = feedback;
      feedbackData.videosToUpdate = [contentId];
    } else if (contentType === 'rawFootage') {
      feedbackData.rawFootageContent = feedback;
      feedbackData.rawFootageToUpdate = [contentId];
    } else {
      feedbackData.photoContent = feedback;
      feedbackData.photosToUpdate = [contentId];
    }
    
    await prisma.feedback.create({ data: feedbackData });
    
    // Update submission status based on individual content statuses
    await updateSubmissionStatusBasedOnContent(submission.id);
    
    console.log(`✅ V4 ${contentType} ${contentId} changes requested by client ${clientId}`);
    
    res.status(200).json({
      message: `Changes requested for ${contentType} by client successfully`,
      content: updatedContent,
      status: updatedContent.status
    });
    
  } catch (error) {
    console.error('Error requesting changes by client for individual content v4:', error);
    res.status(500).json({
      message: 'Failed to request changes',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

/**
 * Get feedback history for individual content
 * GET /api/submissions/v4/content/feedback/:contentType/:contentId
 */
export const getIndividualContentFeedbackV4 = async (req: Request, res: Response) => {
  const { contentType, contentId } = req.params;
  
  try {
    if (!['video', 'rawFootage', 'photo'].includes(contentType)) {
      return res.status(400).json({ 
        message: 'contentType must be video, rawFootage, or photo' 
      });
    }
    
    // Get content item and its submission
    let content;
    let submissionId;
    
    if (contentType === 'video') {
      content = await prisma.video.findUnique({
        where: { id: contentId },
        include: { 
          admin: { select: { id: true, name: true } },
          submission: { select: { id: true } }
        }
      });
      submissionId = content?.submissionId;
    } else if (contentType === 'rawFootage') {
      content = await prisma.rawFootage.findUnique({
        where: { id: contentId },
        include: { 
          admin: { select: { id: true, name: true } },
          submission: { select: { id: true } }
        }
      });
      submissionId = content?.submissionId;
    } else {
      content = await prisma.photo.findUnique({
        where: { id: contentId },
        include: { 
          admin: { select: { id: true, name: true } },
          submission: { select: { id: true } }
        }
      });
      submissionId = content?.submissionId;
    }
    
    if (!content) {
      return res.status(404).json({ message: `${contentType} not found` });
    }
    
    // Get submission-level feedback for this content
    const submissionFeedback = await prisma.feedback.findMany({
      where: {
        submissionId: submissionId || undefined,
        OR: [
          { videosToUpdate: { has: contentId } },
          { rawFootageToUpdate: { has: contentId } },
          { photosToUpdate: { has: contentId } }
        ]
      },
      include: {
        admin: { select: { id: true, name: true } }
      },
      orderBy: { createdAt: 'asc' }
    });
    
    // Combine individual content feedback with submission feedback
    const feedbackHistory = [];
    
    // Add individual content feedback if exists
    if (content.feedback) {
      feedbackHistory.push({
        id: `${contentType}-${contentId}`,
        type: 'individual',
        feedback: content.feedback,
        reasons: content.reasons || [],
        admin: content.admin,
        createdAt: content.feedbackAt || content.updatedAt,
        status: content.status
      });
    }
    
    // Add submission-level feedback
    submissionFeedback.forEach(fb => {
      let feedbackText;
      if (contentType === 'video') {
        feedbackText = fb.content;
      } else if (contentType === 'rawFootage') {
        feedbackText = fb.rawFootageContent;
      } else {
        feedbackText = fb.photoContent;
      }
      
      if (feedbackText) {
        feedbackHistory.push({
          id: fb.id,
          type: 'submission',
          feedback: feedbackText,
          reasons: fb.reasons || [],
          admin: fb.adminId,
          createdAt: fb.createdAt,
          sentToCreator: fb.sentToCreator
        });
      }
    });
    
    // Sort by creation date
    feedbackHistory.sort((a, b) => new Date(a.createdAt || new Date(0)).getTime() - new Date(b.createdAt || new Date(0)).getTime());
    
    res.status(200).json({
      content,
      feedbackHistory,
      totalFeedback: feedbackHistory.length
    });
    
  } catch (error) {
    console.error('Error getting individual content feedback v4:', error);
    res.status(500).json({
      message: 'Failed to get feedback history',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

/**
 * Get feedback for a specific photo
 * GET /api/submissions/v4/photo/:photoId/feedback
 */
export const getPhotoFeedbackV4 = async (req: Request, res: Response) => {
  const { photoId } = req.params;
  
  try {
    // Get photo with submission info
    const photo = await prisma.photo.findUnique({
      where: { id: photoId },
      include: {
        submission: {
          include: {
            feedback: {
              where: {
                photosToUpdate: { has: photoId },
                photoContent: { not: null }
              },
              include: {
                admin: {
                  select: { id: true, name: true, role: true }
                }
              },
              orderBy: { createdAt: 'asc' }
            }
          }
        }
      }
    });

    if (!photo) {
      return res.status(404).json({ message: 'Photo not found' });
    }

    // Only show feedback from feedback table with photoContent
    interface FeedbackHistoryItem {
      id: string;
      type: 'client_feedback' | 'admin_feedback';
      feedback: string | null;
      reasons: string[];
      admin: {
      id: string;
      name: string;
      role?: string;
      } | null;
      createdAt: Date;
      sentToCreator: boolean;
    }

    const feedbackHistory: FeedbackHistoryItem[] = [];

    // Add feedback from feedback table that targets this photo
    photo.submission?.feedback.forEach(fb => {
      feedbackHistory.push({
        id: fb.id,
        type: fb.admin?.role === 'client' ? 'client_feedback' : 'admin_feedback',
        feedback: fb.photoContent,
        reasons: fb.reasons || [],
        admin: fb.admin ? {
          id: fb.admin.id,
          name: fb.admin.name ?? 'Unknown',
          role: fb.admin.role
        } : null,
        createdAt: fb.createdAt,
        sentToCreator: fb.sentToCreator
      });
    });

    // Skip submission-level feedback to avoid duplication in photo feedback dialog

    // Sort by creation date
    feedbackHistory.sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());

    res.status(200).json({
      photo: {
        id: photo.id,
        url: photo.url,
        status: photo.status,
        feedback: photo.feedback,
        reasons: photo.reasons
      },
      feedbackHistory,
      totalFeedback: feedbackHistory.length
    });

  } catch (error) {
    console.error('Error getting photo feedback v4:', error);
    res.status(500).json({
      message: 'Failed to get photo feedback',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

/**
 * Forward individual photo feedback to creator
 * POST /api/submissions/v4/forward-photo-feedback
 */
export const forwardPhotoFeedbackV4 = async (req: Request, res: Response) => {
  const { feedbackId } = req.body;
  const adminId = req.session.userid;
  
  try {
    if (!feedbackId) {
      return res.status(400).json({ message: 'feedbackId is required' });
    }

    // Get the feedback and its associated photo
    const feedback = await prisma.feedback.findUnique({
      where: { id: feedbackId },
      include: {
        submission: {
          include: {
            photos: true
          }
        }
      }
    });

    if (!feedback) {
      return res.status(404).json({ message: 'Feedback not found' });
    }

    if (feedback.sentToCreator) {
      return res.status(400).json({ message: 'Feedback already forwarded to creator' });
    }

    if (!feedback.photosToUpdate || feedback.photosToUpdate.length === 0) {
      return res.status(400).json({ message: 'No photos associated with this feedback' });
    }

    // Update the feedback to be sent to creator
    await prisma.feedback.update({
      where: { id: feedbackId },
      data: {
        sentToCreator: true,
        updatedAt: new Date()
      }
    });

    // Update the associated photos to REVISION_REQUESTED status
    await prisma.photo.updateMany({
      where: {
        id: { in: feedback.photosToUpdate }
      },
      data: {
        status: 'REVISION_REQUESTED',
        adminId,
        feedbackAt: new Date()
      }
    });

    // Update submission status based on individual content statuses
    await updateSubmissionStatusBasedOnContent(feedback.submissionId);

    console.log(`✅ Photo feedback ${feedbackId} forwarded to creator by admin ${adminId}`);
    
    res.status(200).json({
      message: 'Feedback forwarded to creator successfully',
      feedbackId
    });

  } catch (error) {
    console.error('Error forwarding photo feedback:', error);
    res.status(500).json({
      message: 'Failed to forward feedback',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

/**
 * Get feedback for a specific raw footage
 * GET /api/submissions/v4/rawFootage/:rawFootageId/feedback
 */
export const getRawFootageFeedbackV4 = async (req: Request, res: Response) => {
  const { rawFootageId } = req.params;
  
  try {
    // Get raw footage with submission info
    const rawFootage = await prisma.rawFootage.findUnique({
      where: { id: rawFootageId },
      include: {
        submission: {
          include: {
            feedback: {
              where: {
                rawFootageToUpdate: { has: rawFootageId },
                rawFootageContent: { not: null }
              },
              include: {
                admin: {
                  select: { id: true, name: true, role: true }
                }
              },
              orderBy: { createdAt: 'asc' }
            }
          }
        }
      }
    });

    if (!rawFootage) {
      return res.status(404).json({ message: 'Raw footage not found' });
    }

    // Only show feedback from feedback table with rawFootageContent
    interface FeedbackHistoryItem {
      id: string;
      type: 'client_feedback' | 'admin_feedback' | 'individual';
      feedback: string | null;
      reasons: string[];
      admin: {
      id: string;
      name: string;
      role?: string;
      } | null;
      createdAt: Date;
      sentToCreator: boolean;
      status?: string;
    }

    const feedbackHistory: FeedbackHistoryItem[] = [];

    // Add feedback from feedback table that targets this raw footage
    rawFootage.submission?.feedback.forEach(fb => {
      feedbackHistory.push({
        id: fb.id,
        type: fb.admin?.role === 'client' ? 'individual' : 'individual', // Using 'individual' to match frontend expectations
        feedback: fb.rawFootageContent,
        reasons: fb.reasons || [],
        admin: fb.admin ? {
          id: fb.admin.id,
          name: fb.admin.name ?? 'Unknown',
          role: fb.admin.role
        } : null,
        createdAt: fb.createdAt,
        sentToCreator: fb.sentToCreator,
        status: fb.admin?.role === 'client' ? 'CLIENT_FEEDBACK' : 'ADMIN_FEEDBACK'
      });
    });

    // Skip individual raw footage feedback to avoid duplication in raw footage feedback dialog

    // Sort by creation date
    feedbackHistory.sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());

    res.status(200).json({
      content: {
        id: rawFootage.id,
        url: rawFootage.url,
        status: rawFootage.status,
        feedback: rawFootage.feedback,
        reasons: rawFootage.reasons
      },
      feedbackHistory,
      totalFeedback: feedbackHistory.length
    });

  } catch (error) {
    console.error('Error getting raw footage feedback v4:', error);
    res.status(500).json({
      message: 'Failed to get raw footage feedback',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

/**
 * Forward individual raw footage feedback to creator
 * POST /api/submissions/v4/forward-raw-footage-feedback
 */
export const forwardRawFootageFeedbackV4 = async (req: Request, res: Response) => {
  const { feedbackId } = req.body;
  const adminId = req.session.userid;
  
  try {
    if (!feedbackId) {
      return res.status(400).json({ message: 'feedbackId is required' });
    }

    // Get the feedback and its associated raw footage
    const feedback = await prisma.feedback.findUnique({
      where: { id: feedbackId },
      include: {
        submission: {
          include: {
            rawFootages: true
          }
        }
      }
    });

    if (!feedback) {
      return res.status(404).json({ message: 'Feedback not found' });
    }

    if (feedback.sentToCreator) {
      return res.status(400).json({ message: 'Feedback already forwarded to creator' });
    }

    if (!feedback.rawFootageToUpdate || feedback.rawFootageToUpdate.length === 0) {
      return res.status(400).json({ message: 'No raw footage associated with this feedback' });
    }

    // Update the feedback to be sent to creator
    await prisma.feedback.update({
      where: { id: feedbackId },
      data: {
        sentToCreator: true,
        updatedAt: new Date()
      }
    });

    // Update the associated raw footage to REVISION_REQUESTED status
    await prisma.rawFootage.updateMany({
      where: {
        id: { in: feedback.rawFootageToUpdate }
      },
      data: {
        status: 'REVISION_REQUESTED',
        adminId,
        feedbackAt: new Date()
      }
    });

    // Update submission status based on individual content statuses
    await updateSubmissionStatusBasedOnContent(feedback.submissionId);

    console.log(`✅ Raw footage feedback ${feedbackId} forwarded to creator by admin ${adminId}`);
    
    res.status(200).json({
      message: 'Feedback forwarded to creator successfully',
      feedbackId
    });

  } catch (error) {
    console.error('Error forwarding raw footage feedback:', error);
    res.status(500).json({
      message: 'Failed to forward feedback',
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
                name: true,
                role: true
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

/**
 * Get submission status information for a user role
 * GET /api/submissions/v4/status/:submissionId?role=creator|admin|client
 */
export const getSubmissionStatusInfo = async (req: Request, res: Response) => {
  const { submissionId } = req.params;
  const { role } = req.query;
  
  try {
    if (!submissionId || !role) {
      return res.status(400).json({ 
        message: 'submissionId and role query parameter are required' 
      });
    }
    
    if (!['creator', 'admin', 'client'].includes(role as string)) {
      return res.status(400).json({ 
        message: 'role must be creator, admin, or client' 
      });
    }
    
    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        submissionType: true,
        campaign: {
          select: {
            origin: true
          }
        },
        video: {
          select: {
            status: true
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
    
    const { 
      getSubmissionStatusDisplay, 
      canCreatorUpload, 
      canAddPostingLink,
      getAvailableActions 
    } = require('../utils/v4StatusUtils');
    
    const videoStatus = submission.video[0]?.status || 'PENDING';
    
    const statusInfo = {
      submissionId: submission.id,
      submissionStatus: submission.status,
      videoStatus,
      statusDisplay: getSubmissionStatusDisplay(
        submission.status,
        videoStatus,
        role as any,
        submission.campaign.origin as any
      ),
      canUpload: role === 'creator' ? canCreatorUpload(submission.status, videoStatus) : false,
      canAddPostingLink: role === 'creator' ? canAddPostingLink(submission.status, videoStatus) : false,
      availableActions: getAvailableActions(
        submission.status,
        videoStatus,
        role as any,
        submission.campaign.origin as any
      )
    };
    
    res.status(200).json(statusInfo);
    
  } catch (error) {
    console.error('Error getting submission status info:', error);
    res.status(500).json({
      message: 'Failed to get status information',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

/**
 * Update submission due date (admin only)
 */
export const updateSubmissionDueDate = async (req: Request, res: Response) => {
  try {
    const { submissionId, dueDate } = req.body;
    
    if (!submissionId || !dueDate) {
      return res.status(400).json({ 
        success: false, 
        message: 'submissionId and dueDate are required' 
      });
    }

    const { updateDueDateService } = require('../service/submissionV4Service');
    const updatedSubmission = await updateDueDateService(submissionId, dueDate);
    
    res.status(200).json({
      success: true,
      data: updatedSubmission,
      message: 'Due date updated successfully'
    });
  } catch (error) {
    console.error('Error updating due date:', error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to update due date'
    });
  }
};

/**
 * Test endpoint to check V4 campaign completion status
 * GET /api/submissions/v4/completion-status?campaignId=xxx&userId=xxx
 */
export const checkV4CompletionStatus = async (req: Request, res: Response) => {
  const { campaignId, userId } = req.query;
  
  try {
    if (!campaignId || !userId) {
      return res.status(400).json({ 
        message: 'campaignId and userId are required' 
      });
    }
    
    const { checkV4SubmissionCompletion } = await import('../service/submissionV4CompletionService.js');
    const completionStatus = await checkV4SubmissionCompletion(
      campaignId as string,
      userId as string
    );
    
    console.log(`🔍 Completion status check for user ${userId} in campaign ${campaignId}:`, completionStatus);
    
    res.status(200).json({
      campaignId,
      userId,
      ...completionStatus,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error checking completion status:', error);
    res.status(500).json({
      message: 'Failed to check completion status',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

/**
 * Test endpoint to manually trigger V4 campaign completion
 * POST /api/submissions/v4/trigger-completion
 */
export const triggerV4Completion = async (req: Request, res: Response) => {
  const { campaignId, userId } = req.body;
  const adminId = req.session.userid;
  
  try {
    if (!campaignId || !userId) {
      return res.status(400).json({ 
        message: 'campaignId and userId are required' 
      });
    }
    
    const { handleV4CompletedCampaign } = await import('../service/submissionV4CompletionService.js');
    const result = await handleV4CompletedCampaign(campaignId, userId, adminId);
    
    console.log(`🎯 Manual completion trigger for user ${userId} in campaign ${campaignId}: ${result ? 'SUCCESS' : 'NOT READY'}`);
    
    res.status(200).json({
      campaignId,
      userId,
      completed: result,
      message: result ? 'Campaign completed and invoice generated' : 'Campaign not ready for completion',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error triggering completion:', error);
    res.status(500).json({
      message: 'Failed to trigger completion',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};
import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import amqplib from 'amqplib';
import { getV4Submissions, updatePostingLink } from '../service/submissionV4Service';
import { PostingLinkUpdate } from '../types/submissionV4Types';
import { saveCaptionToHistory } from '../utils/captionHistoryUtils';

const prisma = new PrismaClient();

/**
 * Get creator's own V4 submissions for a campaign
 * GET /api/creator/submissions/v4?campaignId=xxx
 */
export const getMyV4Submissions = async (req: Request, res: Response) => {
  const { campaignId } = req.query;
  const creatorId = req.session.userid;

  if (!creatorId) {
    return res.status(401).json({ message: 'You are not logged in' });
  }

  if (!campaignId) {
    return res.status(400).json({ message: 'campaignId is required' });
  }
  try {
    // Verify creator has access to this campaign
    const creatorAccess = await prisma.shortListedCreator.findFirst({
      where: {
        campaignId: campaignId as string,
        userId: creatorId,
      },
    });

    if (!creatorAccess) {
      return res.status(403).json({
        message: 'You do not have access to this campaign or are not approved',
      });
    }

    const submissions = await getV4Submissions(campaignId as string, creatorId);

    console.log(submissions);

    // Filter feedback for each submission based on submission status and type
    const submissionsWithFilteredFeedback = submissions.map((submission) => {
      let filteredFeedback = submission.feedback;
      // When submission status is CLIENT_APPROVED, return only the last two feedback entries
      // regardless of sentToCreator status
      if (submission.status === 'CLIENT_APPROVED') {
        filteredFeedback = submission.feedback.slice(0, 2);
      } else {
        // For other statuses, show all feedback that was sent to creator (both COMMENT and REQUEST types)
        filteredFeedback = submission.feedback.filter((feedback) => feedback.sentToCreator);
      }
      return {
        ...submission,
        feedback: filteredFeedback,
      };
    });

    // Group submissions by type for creator interface
    const groupedSubmissions = {
      agreement: submissionsWithFilteredFeedback.find((s) => s.submissionType.type === 'AGREEMENT_FORM'),
      videos: submissionsWithFilteredFeedback.filter((s) => s.submissionType.type === 'VIDEO'),
      photos: submissionsWithFilteredFeedback.filter((s) => s.submissionType.type === 'PHOTO'),
      rawFootage: submissionsWithFilteredFeedback.filter((s) => s.submissionType.type === 'RAW_FOOTAGE'),
    };

    // Calculate overall progress
    const totalSubmissions = submissionsWithFilteredFeedback.length;
    const completedSubmissions = submissionsWithFilteredFeedback.filter(
      (s) => s.status === 'APPROVED' || s.status === 'CLIENT_APPROVED' || s.status === 'POSTED',
    ).length;
    const progress = totalSubmissions > 0 ? (completedSubmissions / totalSubmissions) * 100 : 0;

    console.log(
      `🎯 Creator ${creatorId} retrieved ${submissionsWithFilteredFeedback.length} v4 submissions for campaign ${campaignId}`,
    );

    res.status(200).json({
      submissions: submissionsWithFilteredFeedback,
      grouped: groupedSubmissions,
      progress: Math.round(progress),
      total: submissionsWithFilteredFeedback.length,
      completed: completedSubmissions,
    });
  } catch (error) {
    console.error('Error getting creator v4 submissions:', error);
    res.status(500).json({
      message: 'Failed to get your submissions',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Submit content for creator's V4 submission with file upload
 * POST /api/creator/submissions/v4/submit-content
 */
export const submitMyV4Content = async (req: Request, res: Response) => {
  let submissionId: string, caption: string;
  const files = req.files as any;
  const creatorId = req.session.userid;

  try {
    if (!creatorId) {
      return res.status(401).json({ message: 'You are not logged in' });
    }

    // Parse JSON data from form data
    let isSelectiveUpdate = false;
    let caption = '';
    let keepExistingPhotos: { id: string; url: string }[] = [];
    let keepExistingRawFootages: { id: string; url: string }[] = [];
    let photosToRemove: string[] = []; // Array of photo IDs to be removed

    try {
      const parsedData = JSON.parse(req.body.data);
      submissionId = parsedData.submissionId;
      caption = parsedData.caption;
      isSelectiveUpdate = parsedData.isSelectiveUpdate || false;
      keepExistingPhotos = parsedData.keepExistingPhotos || [];
      keepExistingRawFootages = parsedData.keepExistingRawFootages || [];
      photosToRemove = parsedData.photosToRemove || []; // Handle photos to be removed
    } catch (parseError) {
      console.error('V4 submit-content JSON parse error:', parseError);
      return res.status(400).json({ message: 'Invalid request data format' });
    }

    if (!submissionId) {
      return res.status(400).json({ message: 'submissionId is required' });
    }

    console.log(`Creator ${creatorId} submitting content V4 for submission ${submissionId}`);

    // Verify this submission belongs to the creator
    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        submissionType: true,
        campaign: {
          include: {
            campaignAdmin: {
              include: {
                admin: {
                  include: { user: true },
                },
              },
            },
          },
        },
        video: true,
        photos: true,
        rawFootages: true,
      },
    });

    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    if (submission.userId !== creatorId) {
      return res.status(403).json({
        message: 'You can only submit content for your own submissions',
      });
    }

    if (submission.submissionVersion !== 'v4') {
      return res.status(400).json({ message: 'Not a v4 submission' });
    }

    // Check if submission is in a state that allows content updates
    const allowedStatuses = ['IN_PROGRESS', 'CHANGES_REQUIRED', 'REJECTED', 'NOT_STARTED', 'CLIENT_FEEDBACK'];
    if (!allowedStatuses.includes(submission.status)) {
      return res.status(400).json({
        message: `Cannot submit content. Current status: ${submission.status}`,
      });
    }

    // Normalize express-fileupload file shapes (single object or array)
    const uploadedVideos = Array.isArray(files?.videos) ? files.videos : files?.videos ? [files.videos] : [];

    const uploadedPhotos = Array.isArray(files?.photos) ? files.photos : files?.photos ? [files.photos] : [];

    const uploadedRawFootages = Array.isArray(files?.rawFootages)
      ? files.rawFootages
      : files?.rawFootages
        ? [files.rawFootages]
        : [];

    // Debug logs for incoming files
    console.log('V4 submit-content incoming payload:', {
      fileKeys: files ? Object.keys(files) : [],
      videosCount: uploadedVideos.length,
      photosCount: uploadedPhotos.length,
      rawFootagesCount: uploadedRawFootages.length,
      submissionType: submission.submissionType.type,
      existingVideos: submission.video?.length || 0,
      existingPhotos: submission.photos?.length || 0,
      existingRawFootages: submission.rawFootages?.length || 0,
      submissionStatus: submission.status,
      isSelectiveUpdate,
      keepExistingPhotosCount: keepExistingPhotos.length,
    });

    const hasUploadedFiles = uploadedVideos.length > 0 || uploadedPhotos.length > 0 || uploadedRawFootages.length > 0;
    const existingMediaCount =
      (submission.video?.length || 0) + (submission.photos?.length || 0) + (submission.rawFootages?.length || 0);

    // For v4, we require at least some content based on submission type
    if (!hasUploadedFiles && existingMediaCount === 0) {
      return res.status(400).json({ message: 'Please upload at least one file before submitting for review.' });
    }

    // Save current caption to history before updating
    await saveCaptionToHistory(submissionId, caption, creatorId!, 'creator');

    // Update submission caption
    await prisma.submission.update({
      where: { id: submissionId },
      data: {
        caption: caption || null,
      },
    });

    // Handle photo removal if requested
    if (photosToRemove.length > 0) {
      // Delete the photos from the database
      await prisma.photo.deleteMany({
        where: {
          id: { in: photosToRemove },
          submissionId: submissionId,
        },
      });
    }

    // V4 Photo Additive System: Never delete existing photos, only add new ones
    const isResubmission = ['CHANGES_REQUIRED', 'REJECTED'].includes(submission.status);

    if (isResubmission) {
      // In V4, we can now both remove existing photos and add new ones
      // This creates a flexible system where creators can manage their photo collection
    }

    // Handle raw footage replacement for V4 resubmissions
    if (isResubmission && uploadedRawFootages.length > 0) {
      if (isSelectiveUpdate && keepExistingRawFootages.length > 0) {
        // Selective update: only delete raw footages that are NOT in the keepExistingRawFootages list
        const existingRawFootageIds = submission.rawFootages?.map((rawFootage) => rawFootage.id) || [];
        const keepRawFootageIds = keepExistingRawFootages.map((rawFootage) => rawFootage.id);
        const rawFootagesToDelete = existingRawFootageIds.filter((id) => !keepRawFootageIds.includes(id));

        console.log(
          `🎬 V4 Controller - Selective update: keeping ${keepRawFootageIds.length} raw footages, deleting ${rawFootagesToDelete.length} raw footages`,
        );
        console.log(`🎬 V4 Controller - Raw footages to keep:`, keepRawFootageIds);
        console.log(`🎬 V4 Controller - Raw footages to delete:`, rawFootagesToDelete);

        if (rawFootagesToDelete.length > 0) {
          await prisma.rawFootage.deleteMany({
            where: {
              id: { in: rawFootagesToDelete },
              submissionId: submissionId,
            },
          });
          console.log(`🎬 V4 Controller - Selectively deleted ${rawFootagesToDelete.length} raw footages`);
        }
      } else {
        // Full replacement: delete all existing raw footages (original behavior)
        console.log(
          `🎬 V4 Controller - Full replacement detected, deleting ${submission.rawFootages?.length || 0} existing raw footages`,
        );

        if (submission.rawFootages?.length > 0) {
          await prisma.rawFootage.deleteMany({
            where: {
              submissionId: submissionId,
            },
          });
          console.log(`🎬 V4 Controller - Deleted ${submission.rawFootages.length} existing raw footages`);
        }
      }
    }

    // Build local file paths and enqueue processing job
    let amqp: amqplib.Connection | null = null;
    let channel: amqplib.Channel | null = null;

    const filePaths = new Map();

    // Handle videos (compress later in worker)
    if (uploadedVideos.length) {
      filePaths.set('video', []);
      for (const video of uploadedVideos) {
        const videoPath = `/tmp/${submissionId}_${video.name}`;
        await video.mv(videoPath);
        filePaths.get('video').push({
          inputPath: videoPath,
          outputPath: `/tmp/${submissionId}_${video.name.replace(/\.[^/.]+$/, '')}_compressed.mp4`,
          fileName: `${submissionId}_${video.name}`,
          originalName: video.name,
        });
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

    // Handle raw footages
    if (uploadedRawFootages.length) {
      filePaths.set('rawFootages', []);
      for (const rawFootage of uploadedRawFootages) {
        const rawFootagePath = `/tmp/${submissionId}_${rawFootage.name}`;
        try {
          await rawFootage.mv(rawFootagePath);
          filePaths.get('rawFootages').push(rawFootagePath);
        } catch (err) {
          console.error('Failed to move raw footage file:', err);
          // skip failed file move - continues processing other files
        }
      }
    }

    // Always trigger worker if there are changes (new files OR photos to remove)
    const hasNewFiles = uploadedVideos.length > 0 || uploadedPhotos.length > 0 || uploadedRawFootages.length > 0;
    const hasPhotosToRemove = photosToRemove.length > 0;

    if (hasNewFiles || hasPhotosToRemove) {
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
          // V4 specific flags
          isV4: true,
          submissionType: submission.submissionType.type,
          // Add existing media info for worker to preserve
          existingMedia: {
            videos: submission.video?.map((v) => ({ id: v.id, status: v.status })) || [],
            photos: submission.photos?.map((p) => ({ id: p.id, status: p.status })) || [],
            rawFootages: submission.rawFootages?.map((r) => ({ id: r.id, status: r.status })) || [],
          },
          // V4 Additive System: Always preserve existing media, never replace
          preserveExistingMedia: true,
          // Include photos to remove for worker processing
          photosToRemove: photosToRemove,
        };

        channel.sendToQueue('draft', Buffer.from(JSON.stringify(payload)), { persistent: true });
      } finally {
        if (channel) await channel.close();
        if (amqp) await amqp.close();
      }
    }

    // Check if there are meaningful changes that warrant status update
    const hasMeaningfulChanges =
      hasUploadedFiles ||
      (isResubmission && isSelectiveUpdate && keepExistingPhotos.length !== (submission.photos?.length || 0)) ||
      (caption && caption.trim() !== (submission.caption || '').trim());

    // Update submission status to PENDING_REVIEW if there are meaningful changes
    if (hasMeaningfulChanges) {
      await prisma.submission.update({
        where: { id: submissionId },
        data: {
          status: 'PENDING_REVIEW',
          updatedAt: new Date(),
        },
      });

      // Emit socket event for real-time updates
      const io = req.app.get('io');
      if (io) {
        io.to(submission.campaignId).emit('v4:content:submitted', {
          submissionId,
          campaignId: submission.campaignId,
          hasVideo: uploadedVideos.length > 0,
          hasPhotos: uploadedPhotos.length > 0,
          hasRawFootage: uploadedRawFootages.length > 0,
          submittedAt: new Date().toISOString(),
          creatorId,
          newStatus: 'PENDING_REVIEW',
        });
      }

      console.log(
        `📤 Creator ${creatorId} submitted V4 content changes for submission ${submissionId}, status updated to PENDING_REVIEW`,
      );
    }

    res.status(200).json({
      message: 'Content submitted successfully and is being processed',
      submissionId,
      filesUploaded: {
        videos: uploadedVideos.length,
        photos: uploadedPhotos.length,
        rawFootages: uploadedRawFootages.length,
      },
    });
  } catch (error) {
    console.error('Error submitting creator v4 content:', error);
    res.status(500).json({
      message: 'Failed to submit content',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Update posting link for creator's approved V4 submission
 * PUT /api/creator/submissions/v4/posting-link
 */
export const updateMyPostingLink = async (req: Request, res: Response) => {
  const { submissionId, postingLink } = req.body as PostingLinkUpdate;
  const creatorId = req.session.userid;

  try {
    if (!creatorId) {
      return res.status(401).json({ message: 'You are not logged in' });
    }

    if (!submissionId || !postingLink) {
      return res.status(400).json({
        message: 'submissionId and postingLink are required',
      });
    }

    // Validate URL format
    try {
      new URL(postingLink);
    } catch {
      return res.status(400).json({ message: 'Invalid posting link URL' });
    }

    // Verify this submission belongs to the creator
    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        submissionType: true,
        campaign: {
          select: { campaignType: true },
        },
      },
    });

    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    if (submission.userId !== creatorId) {
      return res.status(403).json({
        message: 'You can only update posting links for your own submissions',
      });
    }

    if (submission.submissionVersion !== 'v4') {
      return res.status(400).json({ message: 'Not a v4 submission' });
    }

    // Check if campaign type allows posting links
    if (submission.campaign?.campaignType === 'ugc') {
      return res.status(400).json({
        message: 'Posting links are not required for UGC (No posting) campaigns',
      });
    }

    const result = await updatePostingLink(submissionId, postingLink); // Creator adding link - no adminId

    // Emit socket event for real-time updates
    const io = req.app.get('io');
    if (io) {
      io.to(submission.campaignId).emit('v4:posting:updated', {
        submissionId,
        campaignId: submission.campaignId,
        postingLink,
        updatedAt: new Date().toISOString(),
        creatorId,
      });
    }

    console.log(`🔗 Creator ${creatorId} updated posting link for v4 submission ${submissionId}`);

    res.status(200).json({
      message: 'Posting link updated successfully',
      submission: result,
    });
  } catch (error) {
    console.error('Error updating creator posting link:', error);

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
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Get detailed view of creator's specific V4 submission
 * GET /api/creator/submissions/v4/:submissionId
 */
export const getMySubmissionDetails = async (req: Request, res: Response) => {
  const { submissionId } = req.params;
  const creatorId = req.session.userid;

  try {
    if (!creatorId) {
      return res.status(401).json({ message: 'You are not logged in' });
    }

    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        submissionType: true,
        campaign: {
          select: {
            id: true,
            name: true,
            description: true,
          },
        },
        video: {
          select: {
            id: true,
            url: true,
            status: true,
            feedback: true,
            reasons: true,
            feedbackAt: true,
          },
        },
        photos: {
          select: {
            id: true,
            url: true,
            status: true,
            feedback: true,
            reasons: true,
            feedbackAt: true,
          },
        },
        rawFootages: {
          select: {
            id: true,
            url: true,
            status: true,
            feedback: true,
            reasons: true,
            feedbackAt: true,
          },
        },
        feedback: {
          include: {
            admin: {
              select: {
                id: true,
                name: true,
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });

    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    if (submission.userId !== creatorId) {
      return res.status(403).json({
        message: 'You can only view your own submissions',
      });
    }

    if (submission.submissionVersion !== 'v4') {
      return res.status(400).json({ message: 'Not a v4 submission' });
    }

    // Filter feedback based on submission status and type
    let filteredFeedback = submission.feedback;

    if (submission.status === 'CLIENT_APPROVED') {
      filteredFeedback = submission.feedback.slice(0, 2);
    } else {
      filteredFeedback = submission.feedback.filter(
        (feedback) => feedback.sentToCreator && (feedback.type === 'REQUEST' || feedback.type === 'COMMENT'),
      );
    }

    // Add creator-friendly status mapping
    const getCreatorStatus = (status: string) => {
      switch (status) {
        case 'PENDING_REVIEW':
          return 'In Review';
        case 'IN_PROGRESS':
          return 'In Progress';
        case 'APPROVED':
          return 'Approved';
        case 'CLIENT_APPROVED':
          return 'Approved';
        case 'REJECTED':
          return 'Changes Required';
        case 'CHANGES_REQUIRED':
          return 'Changes Required';
        case 'SENT_TO_CLIENT':
          return 'In Review';
        case 'CLIENT_FEEDBACK':
          return 'In Review';
        default:
          return status;
      }
    };

    const submissionWithCreatorStatus = {
      ...submission,
      feedback: filteredFeedback,
      creatorStatus: getCreatorStatus(submission.status),
    };

    console.log(`🔍 Creator ${creatorId} viewed details for v4 submission ${submissionId}`);

    res.status(200).json({ submission: submissionWithCreatorStatus });
  } catch (error) {
    console.error('Error getting creator submission details:', error);
    res.status(500).json({
      message: 'Failed to get submission details',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Get creator's campaign overview with submission summary
 * GET /api/creator/submissions/v4/campaign-overview?campaignId=xxx
 */
export const getMyCampaignOverview = async (req: Request, res: Response) => {
  const { campaignId } = req.query;
  const creatorId = req.session.userid;

  try {
    if (!creatorId) {
      return res.status(401).json({ message: 'You are not logged in' });
    }

    if (!campaignId) {
      return res.status(400).json({ message: 'campaignId is required' });
    }

    // Get campaign details and creator status
    const shortlistedCreator = await prisma.shortListedCreator.findFirst({
      where: {
        campaignId: campaignId as string,
        userId: creatorId,
      },
    });

    if (!shortlistedCreator) {
      return res.status(404).json({
        message: 'Campaign not found or you are not assigned to this campaign',
      });
    }

    // Get campaign details separately
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId as string },
      select: {
        id: true,
        name: true,
        description: true,
        submissionVersion: true,
      },
    });

    // Get submission summary
    const submissions = await getV4Submissions(campaignId as string, creatorId);

    // Find agreement form submission status
    const agreementSubmission = submissions.find((s) => s.submissionType.type === 'AGREEMENT_FORM');
    const isAgreementApproved =
      agreementSubmission?.status === 'APPROVED' || agreementSubmission?.status === 'CLIENT_APPROVED';

    // Filter out agreement form from summary calculations (only count content submissions)
    const contentSubmissions = submissions.filter((s) => s.submissionType.type !== 'AGREEMENT_FORM');

    // Calculate progress and requirements
    const submissionSummary = {
      total: contentSubmissions.length,
      completed: contentSubmissions.filter((s) => s.status === 'APPROVED' || s.status === 'CLIENT_APPROVED').length,
      inReview: contentSubmissions.filter((s) => s.status === 'PENDING_REVIEW' || s.status === 'SENT_TO_CLIENT').length,
      needsChanges: contentSubmissions.filter((s) => s.status === 'CHANGES_REQUIRED' || s.status === 'REJECTED').length,
      inProgress: contentSubmissions.filter((s) => s.status === 'IN_PROGRESS').length,
    };

    const progress =
      submissionSummary.total > 0 ? Math.round((submissionSummary.completed / submissionSummary.total) * 100) : 0;

    console.log(`📊 Creator ${creatorId} viewed campaign overview for ${campaignId}`);

    res.status(200).json({
      campaign,
      creatorStatus: 'APPROVED', // ShortListedCreator doesn't have status field, so they're approved if they exist
      agreementStatus: agreementSubmission?.status || null,
      isAgreementApproved,
      submissions: submissionSummary,
      progress,
      isComplete: progress === 100,
    });
  } catch (error) {
    console.error('Error getting creator campaign overview:', error);
    res.status(500).json({
      message: 'Failed to get campaign overview',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

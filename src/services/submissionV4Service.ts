import { PrismaClient } from '@prisma/client';
import { V4SubmissionCreateData, V4SubmissionType } from '../types/submissionV4Types';

const prisma = new PrismaClient();

/**
 * Create V4 submissions for an approved creator
 * This function is now mainly for consistency - actual content submissions 
 * are created when the agreement is approved via createContentSubmissionsAfterAgreement
 */
export const createV4SubmissionsForCreator = async (data: V4SubmissionCreateData) => {
  const { campaignId, userId } = data;
  
  try {
    console.log(`🔄 V4 submission creation requested for user ${userId} in campaign ${campaignId}`);
    console.log(`ℹ️  Content submissions will be created when agreement is approved`);
    
    // Return empty result since we don't create any submissions here anymore
    // Content submissions are created via createContentSubmissionsAfterAgreement
    return { count: 0 };
  } catch (error) {
    console.error('Error in v4 submission creation:', error);
    throw error;
  }
};

/**
 * Get V4 submissions for a campaign and user
 */
export const getV4Submissions = async (campaignId: string, userId?: string) => {
  try {
    const whereClause: any = {
      campaignId,
      submissionVersion: 'v4',
      campaign: {
        submissionVersion: 'v4'
      }
    };
    
    if (userId) {
      whereClause.userId = userId;
    }
    
    const submissions = await prisma.submission.findMany({
      where: whereClause,
      include: {
        submissionType: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true
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
      },
      orderBy: [
        {
          submissionType: {
            type: 'asc'
          }
        },
        {
          contentOrder: 'asc'
        },
        {
          createdAt: 'asc'
        }
      ]
    });
    
    return submissions;
  } catch (error) {
    console.error('Error getting v4 submissions:', error);
    throw error;
  }
};

/**
 * Update posting link for an approved submission
 */
export const updatePostingLink = async (submissionId: string, postingLink: string) => {
  try {
    // Verify submission is approved and v4
    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: { submissionType: true }
    });
    
    if (!submission) {
      throw new Error('Submission not found');
    }
    
    if (submission.submissionVersion !== 'v4') {
      throw new Error('Not a v4 submission');
    }
    
    if (submission.status !== 'APPROVED') {
      throw new Error('Submission must be approved before adding posting link');
    }
    
    // Update the posting link
    const updatedSubmission = await prisma.submission.update({
      where: { id: submissionId },
      data: { 
        content: postingLink,
        updatedAt: new Date()
      },
      include: {
        submissionType: true,
        video: true,
        photos: true,
        rawFootages: true
      }
    });
    
    return updatedSubmission;
  } catch (error) {
    console.error('Error updating posting link:', error);
    throw error;
  }
};

/**
 * Submit content for a V4 submission
 */
export const submitV4Content = async (
  submissionId: string, 
  contentData: {
    videoUrls?: string[];
    photoUrls?: string[];
    rawFootageUrls?: string[];
    caption?: string;
  }
) => {
  try {
    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: { 
        submissionType: true,
        campaign: true
      }
    });
    
    if (!submission) {
      throw new Error('Submission not found');
    }
    
    if (submission.submissionVersion !== 'v4') {
      throw new Error('Not a v4 submission');
    }
    
    const submissionType = submission.submissionType.type as string;
    
    // Create content records based on submission type
    const updates: any[] = [];
    
    if (submissionType === 'VIDEO' && contentData.videoUrls) {
      for (const url of contentData.videoUrls) {
        updates.push(
          prisma.video.create({
            data: {
              url,
              campaignId: submission.campaignId,
              userId: submission.userId,
              submissionId: submission.id,
              status: 'PENDING'
            }
          })
        );
      }
    }
    
    if (submissionType === 'PHOTO' && contentData.photoUrls) {
      for (const url of contentData.photoUrls) {
        updates.push(
          prisma.photo.create({
            data: {
              url,
              campaignId: submission.campaignId,
              userId: submission.userId,
              submissionId: submission.id,
              status: 'PENDING'
            }
          })
        );
      }
    }
    
    if (submissionType === 'RAW_FOOTAGE' && contentData.rawFootageUrls) {
      for (const url of contentData.rawFootageUrls) {
        updates.push(
          prisma.rawFootage.create({
            data: {
              url,
              campaignId: submission.campaignId,
              userId: submission.userId,
              submissionId: submission.id,
              status: 'PENDING'
            }
          })
        );
      }
    }
    
    // Update submission status and caption
    updates.push(
      prisma.submission.update({
        where: { id: submissionId },
        data: {
          caption: contentData.caption,
          status: 'PENDING_REVIEW',
          submissionDate: new Date(),
          updatedAt: new Date()
        }
      })
    );
    
    // Execute all updates in transaction
    const results = await prisma.$transaction(updates);
    
    return results[results.length - 1]; // Return updated submission
  } catch (error) {
    console.error('Error submitting v4 content:', error);
    throw error;
  }
};

/**
 * Create content submissions when agreement is approved
 * This creates the actual VIDEO, PHOTO, RAW_FOOTAGE submissions
 */
export const createContentSubmissionsAfterAgreement = async (agreementSubmission: any) => {
  try {
    console.log(`🔍 Creating content submissions for user ${agreementSubmission.userId} in campaign ${agreementSubmission.campaignId}`);
    
    // Get campaign details and shortlisted creator info
    const campaign = await prisma.campaign.findUnique({
      where: { id: agreementSubmission.campaignId },
      include: {
        shortlisted: {
          where: { userId: agreementSubmission.userId }
        }
      }
    });

    if (!campaign) {
      console.error(`❌ Campaign ${agreementSubmission.campaignId} not found`);
      throw new Error('Campaign not found');
    }

    console.log(`📋 Campaign found: ${campaign.name}, version: ${campaign.submissionVersion}`);
    console.log(`👥 Found ${campaign.shortlisted.length} shortlisted creators for this user`);

    const shortlistedCreator = campaign.shortlisted[0];
    if (!shortlistedCreator) {
      console.error(`❌ Creator ${agreementSubmission.userId} not found in shortlisted creators for campaign ${agreementSubmission.campaignId}`);
      throw new Error('Creator not found in shortlisted creators');
    }

    console.log(`🎬 Shortlisted creator found - ugcVideos: ${shortlistedCreator.ugcVideos}, campaign photos: ${campaign.photos}, rawFootage: ${campaign.rawFootage}`);

    // Get submission type records
    const submissionTypes = await prisma.submissionType.findMany({
      where: {
        type: {
          in: ['VIDEO', 'PHOTO', 'RAW_FOOTAGE'] as any
        }
      }
    });

    const getSubmissionTypeId = (type: string) => {
      return submissionTypes.find(st => st.type === type)?.id;
    };

    const contentSubmissions = [];

    // Create VIDEO submissions based on ugcVideos count
    const ugcVideos = shortlistedCreator.ugcVideos || 0;
    for (let i = 1; i <= ugcVideos; i++) {
      contentSubmissions.push({
        campaignId: agreementSubmission.campaignId,
        userId: agreementSubmission.userId,
        submissionTypeId: getSubmissionTypeId('VIDEO')!,
        contentOrder: i,
        submissionVersion: 'v4',
        status: 'NOT_STARTED' as const,
        content: null
      });
    }

    // Create PHOTO submission if required
    if (campaign.photos) {
      contentSubmissions.push({
        campaignId: agreementSubmission.campaignId,
        userId: agreementSubmission.userId,
        submissionTypeId: getSubmissionTypeId('PHOTO')!,
        contentOrder: 1, // Single photo submission
        submissionVersion: 'v4',
        status: 'NOT_STARTED' as const,
        content: null
      });
    }

    // Create RAW_FOOTAGE submission if required (single submission, multiple uploads like PHOTOS)
    if (campaign.rawFootage) {
      contentSubmissions.push({
        campaignId: agreementSubmission.campaignId,
        userId: agreementSubmission.userId,
        submissionTypeId: getSubmissionTypeId('RAW_FOOTAGE')!,
        contentOrder: 1, // Single raw footage submission
        submissionVersion: 'v4',
        status: 'NOT_STARTED' as const,
        content: null
      });
    }

    console.log(`📝 Prepared ${contentSubmissions.length} content submissions:`, 
      contentSubmissions.map(s => ({ 
        type: s.submissionTypeId, 
        order: s.contentOrder 
      }))
    );

    // Create all content submissions
    if (contentSubmissions.length > 0) {
      const createdSubmissions = await prisma.submission.createMany({
        data: contentSubmissions
      });

      console.log(`✅ Created ${createdSubmissions.count} content submissions for user ${agreementSubmission.userId} in campaign ${agreementSubmission.campaignId}`);
      
      return createdSubmissions;
    }

    console.log(`⚠️  No content submissions created - ugcVideos: ${shortlistedCreator.ugcVideos}, photos: ${campaign.photos}, rawFootage: ${campaign.rawFootage}`);
    return { count: 0 };
  } catch (error) {
    console.error('Error creating content submissions after agreement:', error);
    throw error;
  }
};
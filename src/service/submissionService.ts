import { MAP_TIMELINE } from '@constants/map-timeline';
import { getColumnId } from '@controllers/kanbanController';
import { notificationApproveDraft, notificationRejectDraft } from '@helper/notification';
import { PrismaClient } from '@prisma/client';
import { Request } from 'express';
import { getTaskId, updateTask } from './kanbanService';
import { saveNotification } from '@controllers/notificationController';
import { deductCredits } from './campaignServices';
import { createInvoiceService } from './invoiceService';

const prisma = new PrismaClient();

export const getCreatorInvoiceLists = async (submissionId: string, prismaFunc?: PrismaClient) => {
  try {
    const submission = await (prismaFunc ?? prisma).submission.findUnique({
      where: {
        id: submissionId,
      },
      include: {
        video: true,
        photos: true,
        rawFootages: true,
        dependentOn: {
          select: {
            dependentSubmission: {
              select: {
                video: true,
                photos: true,
                rawFootages: true,
              },
            },
          },
        },
        submissionType: {
          select: {
            type: true,
          },
        },
      },
    });

    if (!submission) throw new Error('Submission not found');

    const [videos, rawFootages, photos] = await Promise.all([
      prisma.video.count({ where: { userId: submission.userId, campaignId: submission.campaignId } }),
      prisma.rawFootage.count({ where: { userId: submission.userId, campaignId: submission.campaignId } }),
      prisma.photo.count({ where: { userId: submission.userId, campaignId: submission.campaignId } }),
    ]);

    // let listItems: any;

    // if (submission.submissionType.type === 'FINAL_DRAFT' && submission.status === 'APPROVED') {
    //   listItems = [
    //     ...(submission.dependentOn[0].dependentSubmission?.video
    //       ? [{ type: 'video', count: submission.dependentOn[0].dependentSubmission?.video.length }]
    //       : []),
    //     ...(submission.dependentOn[0].dependentSubmission?.photos?.length
    //       ? [{ type: 'photos', count: submission.dependentOn[0].dependentSubmission.photos.length }]
    //       : []),
    //     ...(submission.dependentOn[0].dependentSubmission?.rawFootages?.length
    //       ? [{ type: 'rawFootages', count: submission.dependentOn[0].dependentSubmission.rawFootages.length }]
    //       : []),
    //   ];
    // } else {
    const listItems = [
      ...(submission?.video ? [{ type: 'video', count: videos }] : []),
      ...(submission?.photos?.length ? [{ type: 'photos', count: photos }] : []),
      ...(submission?.rawFootages?.length ? [{ type: 'rawFootages', count: rawFootages }] : []),
    ];
    // }

    return listItems;
  } catch (error) {
    throw new Error(error);
  }
};

export const handleKanbanSubmission = async (submissionId: string) => {
  try {
    const submission = await prisma.submission.findUnique({
      where: {
        id: submissionId,
      },
      select: {
        id: true,
        userId: true,
        user: {
          select: {
            Board: true,
          },
        },
        submissionType: true,
        dependencies: true,
        campaign: {
          select: {
            campaignAdmin: {
              select: {
                admin: {
                  select: {
                    user: {
                      select: {
                        Board: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!submission) throw new Error('Submission not found');

    const doneColumnId = await getColumnId({ userId: submission.userId, columnName: 'Done' });
    const inReviewId = await getColumnId({ userId: submission.userId, columnName: 'In Review' });
    const inProgressColumnId = await getColumnId({ userId: submission.userId, columnName: 'In Progress' });

    if (inReviewId) {
      const inReviewColumn = await prisma.columns.findUnique({
        where: {
          id: inReviewId,
        },
        include: {
          task: true,
        },
      });
      const taskInReview = inReviewColumn?.task.find((item) => item.submissionId === submission.id);

      if (submission.submissionType.type === 'FIRST_DRAFT') {
        if (taskInReview && doneColumnId) {
          await prisma.task.update({
            where: {
              id: taskInReview.id,
            },
            data: {
              columnId: doneColumnId,
            },
          });
        }

        const finalDraftSubmission = await prisma.submission.update({
          where: {
            id: submission.dependencies[0].submissionId as string,
          },
          data: {
            status: 'IN_PROGRESS',
          },
          include: {
            task: true,
            user: {
              include: {
                Board: true,
              },
            },
          },
        });

        if (finalDraftSubmission.user.Board) {
          const finalDraft = await getTaskId({
            boardId: finalDraftSubmission.user.Board.id,
            submissionId: finalDraftSubmission.id,
            columnName: 'To Do',
          });

          if (finalDraft && inProgressColumnId) {
            await prisma.task.update({
              where: {
                id: finalDraft?.id,
              },
              data: {
                columnId: inProgressColumnId,
              },
            });
          }
        }
      }
    } else if (submission.submissionType.type === 'FINAL_DRAFT') {
      const finalDraftTaskId = await getTaskId({
        boardId: submission?.user?.Board?.id as any,
        submissionId: submission.id,
        columnName: 'In Review',
      });

      if (finalDraftTaskId) {
        await updateTask({
          taskId: finalDraftTaskId.id as any,
          toColumnId: inProgressColumnId as any,
          userId: submission.userId,
        });
      }
    }

    for (const item of submission.campaign.campaignAdmin) {
      if (item.admin.user.Board) {
        const task = await getTaskId({
          boardId: item.admin.user.Board?.id,
          submissionId: submission.id,
          columnName: 'Actions Needed',
        });

        if (task) {
          await prisma.task.delete({
            where: {
              id: task.id,
            },
          });
        }
      }
    }
  } catch (error) {
    throw new Error(error);
  }
};

export const handleSubmissionNotification = async (submissionId: string) => {
  try {
    const submission = await prisma.submission.findUnique({
      where: {
        id: submissionId,
      },
      select: {
        id: true,
        userId: true,
        submissionType: true,
        dependencies: true,
        campaign: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!submission) throw new Error('Submission not found');

    const { title, message } = notificationRejectDraft(
      submission.campaign.name,
      MAP_TIMELINE[submission.submissionType.type],
    );

    const notification = await saveNotification({
      userId: submission.userId,
      message: message,
      title: title,
      entity: 'Draft',
      entityId: submission.campaign.id,
    });

    return notification;
  } catch (error) {
    throw new Error(error);
  }
};

export const handleCompletedCampaign = async (submissionId: string) => {
  try {
    console.log('🎯 Starting handleCompletedCampaign for submission:', submissionId);

    const submission = await prisma.submission.findUnique({
      where: {
        id: submissionId,
      },
      include: {
        user: {
          include: {
            creator: true,
            paymentForm: true,
            creatorAgreement: true,
            Board: true,
          },
        },
        campaign: true,
        submissionType: true,
        video: true,
        photos: true,
        rawFootages: true,
      },
    });

    if (!submission) {
      console.log('❌ Submission not found:', submissionId);
      throw new Error('Submission not found');
    }

    console.log('📋 Found submission:', {
      id: submission.id,
      userId: submission.userId,
      campaignId: submission.campaignId,
      campaignName: submission.campaign.name,
      submissionType: submission.submissionType.type,
      campaignType: submission.campaign.campaignType,
      status: submission.status,
    });

    // Determine if this campaign should be completed based on submission type and campaign type
    let shouldCompleteCampaign = false;

    if (submission.campaign.campaignType === 'ugc') {
      // For UGC campaigns, complete when FIRST_DRAFT or FINAL_DRAFT is approved
      if (submission.submissionType.type === 'FIRST_DRAFT' || submission.submissionType.type === 'FINAL_DRAFT') {
        shouldCompleteCampaign = true;
        console.log('✅ UGC campaign - checking draft approval');
      }
    } else {
      // For normal campaigns, complete only when POSTING is approved
      if (submission.submissionType.type === 'POSTING') {
        shouldCompleteCampaign = true;
        console.log('✅ Normal campaign - checking posting approval');
      }
    }

    if (!shouldCompleteCampaign) {
      console.log(
        '⏭️ Skipping campaign completion - conditions not met for submission type:',
        submission.submissionType.type,
        'campaign type:',
        submission.campaign.campaignType,
      );
      return;
    }

    // Check if submission is ready for completion
    let isReadyForCompletion = false;

    if (submission.status === 'APPROVED') {
      // V1 scenario: submission is fully approved
      isReadyForCompletion = true;
      console.log('✅ V1 scenario - submission is APPROVED');
    } else {
      // V2 scenario: check if all required media items are individually approved
      console.log('🔍 V2 scenario - checking individual media approval status');

      const requiresVideos = true; // Videos are always required
      const requiresRawFootages = submission.campaign.rawFootage === true;
      const requiresPhotos = submission.campaign.photos === true;

      const videosApproved =
        !requiresVideos || submission.video.length === 0 || submission.video.every((v) => v.status === 'APPROVED');
      const rawFootagesApproved =
        !requiresRawFootages ||
        submission.rawFootages.length === 0 ||
        submission.rawFootages.every((rf) => rf.status === 'APPROVED');
      const photosApproved =
        !requiresPhotos || submission.photos.length === 0 || submission.photos.every((p) => p.status === 'APPROVED');

      isReadyForCompletion = videosApproved && rawFootagesApproved && photosApproved;

      console.log('📊 Media approval status:', {
        requiresVideos,
        requiresRawFootages,
        requiresPhotos,
        videosApproved,
        rawFootagesApproved,
        photosApproved,
        isReadyForCompletion,
      });
    }

    if (!isReadyForCompletion) {
      console.log('⏭️ Skipping campaign completion - not all required media approved yet');
      return;
    }

    // Check if campaign is already completed to prevent duplicate processing
    const shortlistedCreator = await prisma.shortListedCreator.findFirst({
      where: {
        AND: [{ userId: submission.userId }, { campaignId: submission.campaignId }],
      },
    });

    if (!shortlistedCreator) {
      console.log(
        '❌ Shortlisted creator not found for userId:',
        submission.userId,
        'campaignId:',
        submission.campaignId,
      );
      throw new Error('Shortlisted creator not found.');
    }

    if (shortlistedCreator.isCampaignDone) {
      console.log('⏭️ Campaign already completed - skipping duplicate processing');
      return;
    }

    console.log(
      '👤 Found shortlisted creator:',
      shortlistedCreator.id,
      'isCampaignDone:',
      shortlistedCreator.isCampaignDone,
    );

    const invoiceAmount = submission.user.creatorAgreement.find(
      (elem: any) => elem.campaignId === submission.campaignId,
    )?.amount;

    console.log('💰 Invoice amount found:', invoiceAmount);

    if (!invoiceAmount) {
      console.log('⚠️ Invoice amount not found, but continuing with campaign completion...');
      // Don't throw error, just log and continue with marking campaign as done
    } else {
      console.log('💳 Processing invoice and credits...');

      if (submission.campaign.campaignCredits !== null) {
        console.log('🔄 Deducting credits...');
        await deductCredits(submission.campaignId, submission.userId);
      }

      const invoiceItems = await getCreatorInvoiceLists(submission.id);
      console.log('📄 Invoice items:', invoiceItems);

      await createInvoiceService(submission, submission.userId, invoiceAmount, invoiceItems);
      console.log('✅ Invoice created successfully');
    }

    await prisma.shortListedCreator.update({
      where: {
        id: shortlistedCreator.id,
      },
      data: {
        isCampaignDone: true,
      },
    });

    console.log(
      '🎉 Campaign marked as done! isCampaignDone set to true for',
      submission.campaign.campaignType,
      'campaign on',
      submission.submissionType.type,
      'approval',
    );
  } catch (error) {
    console.log('❌ Error in handleCompletedCampaign:', error);
    // Don't throw error to prevent breaking the approval flow
    // Just log the error and continue
  }
};

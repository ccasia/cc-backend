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
      id: submissionId
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
      submissionType: true
    }
  })

  if(!submission) {
    console.log('❌ Submission not found:', submissionId);
    throw new Error("Submission not found")
  }

  console.log('📋 Found submission:', {
    id: submission.id,
    userId: submission.userId,
    campaignId: submission.campaignId,
    campaignName: submission.campaign.name,
    submissionType: submission.submissionType.type
  });

  // Only mark campaign as done for POSTING submissions, not for draft submissions
  if (submission.submissionType.type !== 'POSTING') {
    console.log('⏭️ Skipping campaign completion - this is not a POSTING submission, type:', submission.submissionType.type);
    return;
  }

  const invoiceAmount = submission.user.creatorAgreement.find(
    (elem: any) => elem.campaignId === submission.campaignId,
  )?.amount;

  console.log('💰 Invoice amount found:', invoiceAmount);

  if(!invoiceAmount) {
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

  const shortlistedCreator = await prisma.shortListedCreator.findFirst({
    where: {
      AND: [{ userId: submission.userId }, { campaignId: submission.campaignId }],
    },
  });

  if (!shortlistedCreator) {
    console.log('❌ Shortlisted creator not found for userId:', submission.userId, 'campaignId:', submission.campaignId);
    throw new Error('Shortlisted creator not found.');
  }

  console.log('👤 Found shortlisted creator:', shortlistedCreator.id);

  await prisma.shortListedCreator.update({
    where: {
      id: shortlistedCreator.id,
    },
    data: {
      isCampaignDone: true,
    },
  });

  console.log('🎉 Campaign marked as done! isCampaignDone set to true for POSTING submission');
    
} catch (error) {
  console.log('❌ Error in handleCompletedCampaign:', error);
  // Don't throw error to prevent breaking the approval flow
  // Just log the error and continue
}

} 
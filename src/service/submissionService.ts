import { MAP_TIMELINE } from '@constants/map-timeline';
import { getColumnId } from '@controllers/kanbanController';
import { notificationApproveDraft, notificationRejectDraft } from '@helper/notification';
import { PrismaClient } from '@prisma/client';
import { Request } from 'express';
import { getTaskId, updateTask } from './kanbanService';
import { saveNotification } from '@controllers/notificationController';

const prisma = new PrismaClient();

export const getCreatorInvoiceLists = async (submissionId: string, prisma: PrismaClient) => {
  try {
    const submission = await prisma.submission.findUnique({
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

import { MAP_TIMELINE } from '@constants/map-timeline';
import { notificationApproveDraft, notificationRejectDraft } from '@helper/notification';
import { PrismaClient } from '@prisma/client';
import { Request } from 'express';

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

// export const handleApproval = async (req: Request, submissionId: string, feedback: string, videos: any[]) => {
//   return await prisma.$transaction(async (tx) => {
//     const approveSubmission = await tx.submission.update({
//       where: { id: submissionId },
//       data: {
//         status: 'APPROVED',
//         isReview: true,
//         ...(feedback && {
//           feedback: {
//             create: {
//               type: 'COMMENT',
//               content: feedback,
//               adminId: req.session.userid,
//             },
//           },
//         }),
//       },
//       include: {
//         user: {
//           select: {
//             Board: true,
//           },
//         },
//         campaign: true,
//         submissionType: true,
//         task: true,
//         video: true,
//       },
//     });

//     await updateVideoStatus(tx, approveSubmission.userId, approveSubmission.campaignId, videos, 'APPROVED');
//     await updateTaskStatus(tx, approveSubmission.user.Board, approveSubmission.id, 'Done');
//     await handleCampaignTypeSpecificLogic(tx, approveSubmission, req);

//     const { title, message } = notificationApproveDraft(
//       approveSubmission.campaign.name,
//       MAP_TIMELINE[approveSubmission.submissionType.type],
//     );

//     await sendNotification(approveSubmission.userId, title, message, 'Draft', approveSubmission.campaignId);
//   });
// };

// export const handleRejection = async (
//   req: Request,
//   submissionId: string,
//   feedback: string,
//   reasons: any[],
//   videos: any[],
// ) => {
//   return await prisma.$transaction(async (tx) => {
//     const submission = await tx.submission.findUnique({
//       where: { id: submissionId },
//       include: { video: true, submissionType: true, dependencies: true, campaign: true, user: true },
//     });

//     if (!submission) throw new Error('Submission not found');

//     await updateVideoStatus(tx, submission.userId, submission.campaignId, videos, 'REVISION_REQUESTED');
//     await updateSubmissionStatus(tx, submission.id, 'CHANGES_REQUIRED', feedback, reasons, req.session.userid);
//     await updateTaskStatus(tx, submission.user.Board, submission.id, 'In Progress');

//     const { title, message } = notificationRejectDraft(
//       submission.campaign.name,
//       MAP_TIMELINE[submission.submissionType.type],
//     );

//     await sendNotification(submission.userId, title, message, 'Draft', submission.campaignId);
//   });
// };

// export const updateVideoStatus = async (tx: any, userId: string, campaignId: string, videos: any[], status: string) => {
//   await tx.video.updateMany({
//     where: { userId, campaignId, id: { in: videos.map((x) => x.id) } },
//     data: { status },
//   });
// };

// export const updateTaskStatus = async (tx: any, board: any, submissionId: string, columnName: string) => {
//   if (board) {
//     const columnId = await getColumnId({ userId: board.userId, columnName });
//     const task = await getTaskId({ boardId: board.id, submissionId, columnName: 'In Review' });

//     if (task && columnId) {
//       await tx.task.update({
//         where: { id: task.id },
//         data: { columnId },
//       });
//     }
//   }
// };

// export const sendNotification = async (
//   userId: string,
//   title: string,
//   message: string,
//   entity: string,
//   entityId: string,
// ) => {
//   const notification = await saveNotification({ userId, title, message, entity, entityId });
//   io.to(clients.get(userId)).emit('notification', notification);
//   io.to(clients.get(userId)).emit('newFeedback');
// };

// export const handleCampaignTypeSpecificLogic = async (tx: any, submission: any, req: Request) => {
//   if (submission.campaign.campaignType === 'ugc') {
//     await handleUGCCampaign(tx, submission);
//   } else if (submission.campaign.campaignType === 'normal') {
//     await handleNormalCampaign(tx, submission, req);
//   }
// };

// export const handleUGCCampaign = async (tx: any, submission: any) => {
//   const invoiceAmount = submission.user.creatorAgreement.find(
//     (elem: any) => elem.campaignId === submission.campaign.id,
//   )?.amount;

//   if (submission.campaign.campaignCredits !== null) {
//     await deductCredits(submission.campaignId, submission.userId, tx);
//   }

//   const invoiceItems = await getCreatorInvoiceLists(submission.id, tx);
//   await createInvoiceService(submission, submission.userId, invoiceAmount, invoiceItems);

//   const shortlistedCreator = await tx.shortListedCreator.findFirst({
//     where: { userId: submission.userId, campaignId: submission.campaignId },
//   });

//   if (!shortlistedCreator) throw new Error('Shortlisted creator not found.');

//   await tx.shortListedCreator.update({
//     where: { id: shortlistedCreator.id },
//     data: { isCampaignDone: true },
//   });
// };

// export const handleNormalCampaign = async (tx: any, submission: any, req: Request) => {
//   const posting = await tx.submission.findFirst({
//     where: {
//       userId: submission.userId,
//       campaignId: submission.campaignId,
//       submissionType: { type: 'POSTING' },
//     },
//     include: { user: true, task: true, campaign: true },
//   });

//   if (!posting) throw new Error('Submission called posting not found.');

//   const inProgressColumnId = await getColumnId({ userId: posting.userId, columnName: 'In Progress' });
//   const toDoColumn = posting.user.Board?.columns.find((item) => item.name === 'To Do');
//   const task = toDoColumn?.task.find((item) => item.submissionId === posting.id);

//   if (task && inProgressColumnId) {
//     await tx.task.update({
//       where: { id: task.id },
//       data: { columnId: inProgressColumnId },
//     });
//   }

//   await tx.submission.update({
//     where: { id: posting.id },
//     data: {
//       status: 'IN_PROGRESS',
//       startDate: dayjs(req.body.schedule.startDate).format(),
//       endDate: dayjs(req.body.schedule.endDate).format(),
//       dueDate: dayjs(req.body.schedule.endDate).format(),
//     },
//   });

//   const images: any = posting.campaign.campaignBrief?.images;
//   postingSchedule(
//     submission.user.email,
//     submission.campaign.name,
//     submission.user.name ?? 'Creator',
//     submission.campaign.id,
//     images[0],
//   );
// };

export const updateSubmissionStatus = async () => {
  try {
    console.log('test');
  } catch (error) {
    throw new Error(error);
  }
};

import e, { Request, Response } from 'express';

import { Entity, PrismaClient, SubmissionStatus } from '@prisma/client';
import { uploadAgreementForm, uploadPitchVideo } from '@configs/cloudStorage.config';
import { saveNotification } from './notificationController';
import { clients, io } from '../server';
import Ffmpeg from 'fluent-ffmpeg';
import FfmpegPath from '@ffmpeg-installer/ffmpeg';
import amqplib from 'amqplib';
import dayjs from 'dayjs';
import { MAP_TIMELINE } from '@constants/map-timeline';

import { createInvoiceService } from '../service/invoiceService';

import {
  notificationAgreement,
  notificationApproveAgreement,
  notificationApproveDraft,
  notificationDraft,
  notificationPosting,
  notificationRejectDraft,
} from '@helper/notification';
import { getColumnId } from './kanbanController';

Ffmpeg.setFfmpegPath(FfmpegPath.path);
// Ffmpeg.setFfmpegPath(FfmpegProbe.path);

const prisma = new PrismaClient();

export const agreementSubmission = async (req: Request, res: Response) => {
  const { submissionId } = JSON.parse(req.body.data);

  try {
    if (req.files && req.files.agreementForm) {
      const url = await uploadAgreementForm(
        (req.files as any).agreementForm.tempFilePath,
        (req.files as any).agreementForm.name,
        'agreement',
      );

      const submission = await prisma.submission.update({
        where: {
          id: submissionId,
        },
        data: {
          status: 'PENDING_REVIEW',
          content: url as string,
          submissionDate: dayjs().format(),
        },
        include: {
          user: true,
          campaign: {
            include: {
              campaignAdmin: true,
            },
          },
          task: true,
        },
      });

      const boards = await prisma.board.findFirst({
        where: {
          userId: submission.userId,
        },
        include: {
          columns: true,
        },
      });

      if (!boards) {
        return res.status(404).json({ message: 'Board not found' });
      }

      const inReviewColumn = boards.columns.find((column) => column.name === 'In Review');

      await prisma.task.update({
        where: {
          id: submission.task?.id,
        },
        data: {
          columnId: inReviewColumn?.id,
        },
      });

      const { title, message } = notificationAgreement(submission.campaign.name, 'Creator');

      const creatorNotification = await saveNotification({
        userId: submission.userId,
        entity: 'Agreement',
        entityId: submission.campaignId,
        title: title,
        message: message,
      });

      io.to(clients.get(submission.userId)).emit('notification', creatorNotification);

      const { title: adminTitle, message: adminMessage } = notificationAgreement(
        submission.campaign.name,
        'Admin',
        submission.user.name as string,
      );

      submission.campaign.campaignAdmin.forEach(async (item) => {
        const adminNotification = await saveNotification({
          userId: item.adminId,
          entity: 'Agreement',
          entityId: submission.campaignId,
          title: adminTitle,
          message: adminMessage,
        });

        io.to(clients.get(item.adminId)).emit('notification', adminNotification);
      });
    }
    return res.status(200).json({ message: 'Successfully submitted' });
  } catch (error) {
    //console.log(error);
    return res.status(400).json(error);
  }
};

export const adminManageAgreementSubmission = async (req: Request, res: Response) => {
  const data = req.body;

  const { campaignId, userId, status, submissionId } = data;
  const nextSubmissionId = data?.submission?.dependencies[0]?.submissionId;

  try {
    const campaign = await prisma.campaign.findUnique({
      where: {
        id: campaignId,
      },
    });

    const boards = await prisma.board.findFirst({
      where: {
        userId: userId,
      },
      include: {
        columns: true,
      },
    });

    if (!boards) {
      return res.status(404).json({ message: 'Board not found' });
    }

    const doneColumn = boards.columns.find((column) => column.name === 'Done');
    const inProgressColumn = boards.columns.find((column) => column.name === 'In Progress');

    if (status === 'approve') {
      const agreementSubs = await prisma.submission.update({
        where: {
          id: submissionId,
        },
        data: {
          status: 'APPROVED',
          isReview: true,
        },
        include: {
          task: true,
        },
      });

      await prisma.task.update({
        where: {
          id: agreementSubs.task?.id,
        },
        data: {
          columnId: doneColumn?.id,
        },
      });

      const submission = await prisma.submission.update({
        where: {
          id: nextSubmissionId as string,
        },
        data: {
          status: 'IN_PROGRESS',
        },
        include: {
          task: true,
        },
      });

      await prisma.task.update({
        where: {
          id: submission.task?.id,
        },
        data: {
          columnId: inProgressColumn?.id,
        },
      });

      const { title, message } = notificationApproveAgreement(campaign?.name as string);

      const notification = await saveNotification({
        userId: userId,
        message: message,
        title: title,
        entity: 'Campaign',
        entityId: campaign?.id,
      });

      io.to(clients.get(userId)).emit('notification', notification);
    } else if (data.status === 'reject') {
      const { feedback, campaignTaskId, submissionId, userId, submission: sub } = data;

      const submission = await prisma.submission.update({
        where: {
          id: submissionId,
        },
        data: {
          status: 'CHANGES_REQUIRED',
          isReview: true,
        },
      });

      await prisma.feedback.upsert({
        where: {
          submissionId: submission.id,
        },
        update: {
          content: feedback,
        },
        create: {
          content: feedback,
          submissionId: submission.id,
          adminId: req.session.userid as string,
        },
      });

      const notification = await saveNotification({
        userId: userId,
        title: `Agreement Rejected`,
        message: `Please Resubmit Your Agreement Form for ${campaign?.name}`,
        entity: 'Agreement',
      });

      io.to(clients.get(userId)).emit('notification', notification);
    }

    return res.status(200).json({ message: 'Successfully updated' });
  } catch (error) {
    console.log(error);
    return res.status(400).json(error);
  }
};

export const getSubmissionByCampaignCreatorId = async (req: Request, res: Response) => {
  const { creatorId, campaignId } = req.query;

  try {
    const data = await prisma.submission.findMany({
      where: {
        userId: creatorId as string,
        campaignId: campaignId as string,
      },
      include: {
        submissionType: {
          select: {
            id: true,
            type: true,
          },
        },
        feedback: true,
        dependentOn: true,
        dependencies: true,
      },
    });

    //console.log(data);

    return res.status(200).json(data);
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const draftSubmission = async (req: Request, res: Response) => {
  const { submissionId, caption } = JSON.parse(req.body.data);
  const amqp = await amqplib.connect(process.env.RABBIT_MQ as string);
  const channel = await amqp.createChannel();
  await channel.assertQueue('draft');
  const userid = req.session.userid;

  try {
    if (!(req.files as any).draftVideo) {
      return res.status(404).json({ message: 'Video not found.' });
    }

    const submission = await prisma.submission.findUnique({
      where: {
        id: submissionId,
      },
      include: {
        submissionType: true,
        task: true,
      },
    });

    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    // const inReviewColumn = await getColumnId({ userId: userid, columnName: 'In Review' });

    // await prisma.task.update({
    //   where: {
    //     id: submission.task?.id,
    //   },
    //   data: {
    //     columnId: inReviewColumn,
    //   },
    // });

    const file = (req.files as any).draftVideo;

    const filePath = `/tmp/${submissionId}`;
    const compressedFilePath = `/tmp/${submissionId}_compressed.mp4`;

    await file.mv(filePath);

    channel.sendToQueue(
      'draft',
      Buffer.from(
        JSON.stringify({
          ...file,
          userid,
          inputPath: filePath,
          outputPath: compressedFilePath,
          submissionId: submission?.id,
          fileName: `${submission?.id}_draft.mp4`,
          folder: submission?.submissionType.type,
          caption,
        }),
      ),
      {
        persistent: true,
      },
    );

    await channel.close();
    await amqp.close();

    return res.status(200).json({ message: 'Video start processing' });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const adminManageDraft = async (req: Request, res: Response) => {
  const { submissionId, feedback, type, reasons, userId } = req.body;

  try {
    const submission = await prisma.submission.findUnique({
      where: {
        id: submissionId,
      },
      include: {
        feedback: true,
        campaign: true,
        user: true,
      },
    });

    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    if (type === 'approve') {
      const sub = await prisma.submission.update({
        where: {
          id: submission?.id,
        },
        data: {
          status: 'APPROVED',
          isReview: true,
          feedback: feedback && {
            upsert: {
              where: {
                id: submission?.feedback?.id,
              },
              update: {
                content: feedback,
                admin: {
                  connect: { id: req.session.userid },
                },
              },
              create: {
                type: 'COMMENT',
                content: feedback,
                adminId: req.session.userid as string,
              },
            },
          },
        },
        include: {
          user: true,
          submissionType: true,
          task: true,
        },
      });

      const doneColumnId = await getColumnId({ userId: sub.userId, columnName: 'Done' });

      await prisma.task.update({
        where: {
          id: sub.task?.id,
        },
        data: {
          columnId: doneColumnId,
        },
      });

      if (
        (sub.submissionType.type === 'FIRST_DRAFT' || sub.submissionType.type === 'FINAL_DRAFT') &&
        sub.status === 'APPROVED'
      ) {
        const posting = await prisma.submission.findFirst({
          where: {
            AND: [
              { userId: userId },
              { campaignId: submission.campaignId },
              {
                submissionType: {
                  type: {
                    equals: 'POSTING',
                  },
                },
              },
            ],
          },
          include: {
            task: true,
          },
        });

        if (!posting) {
          return res.status(404).json({ message: 'Submission called posting not found.' });
        }

        const inProgressColumnId = await getColumnId({ userId: posting.userId, columnName: 'In Progress' });

        await prisma.task.update({
          where: {
            id: posting.task?.id,
          },
          data: {
            columnId: inProgressColumnId,
          },
        });

        await prisma.submission.update({
          where: {
            id: posting.id,
          },
          data: {
            status: 'IN_PROGRESS',
            startDate: dayjs(req.body.schedule.startDate).format(),
            endDate: dayjs(req.body.schedule.endDate).format(),
            dueDate: dayjs(req.body.schedule.endDate).format(),
          },
        });
      }

      const { title, message } = notificationApproveDraft(
        submission.campaign.name,
        MAP_TIMELINE[sub.submissionType.type],
      );

      const notification = await saveNotification({
        userId: submission.userId,
        title: title,
        message: message,
        entity: 'Draft',
        entityId: submission.campaignId,
      });

      io.to(sub.userId).emit('notification', notification);

      return res.status(200).json({ message: 'Succesfully submitted.' });
    } else {
      const sub = await prisma.submission.update({
        where: {
          id: submissionId,
        },
        data: {
          status: 'CHANGES_REQUIRED',
          isReview: true,
          feedback: {
            upsert: {
              where: {
                id: submission?.feedback?.id,
              },
              update: {
                reasons: reasons,
                content: feedback,
                admin: {
                  connect: { id: req.session.userid },
                },
              },
              create: {
                type: 'REASON',
                reasons: reasons,
                content: feedback,
                admin: {
                  connect: { id: req.session.userid },
                },
              },
            },
          },
        },
        include: {
          user: true,
          submissionType: true,
          dependencies: true,
          task: true,
        },
      });

      const doneColumnId = await getColumnId({ userId: sub.userId, columnName: 'Done' });

      await prisma.task.update({
        where: {
          id: sub.task?.id,
        },
        data: {
          columnId: doneColumnId,
        },
      });

      const finalDraft = await prisma.submission.update({
        where: {
          id: sub.dependencies[0].submissionId as string,
        },
        data: {
          status: 'IN_PROGRESS',
        },
        include: {
          task: true,
        },
      });

      const inProgressColumnId = await getColumnId({ userId: sub.userId, columnName: 'In Progress' });

      await prisma.task.update({
        where: {
          id: finalDraft.task?.id,
        },
        data: {
          columnId: inProgressColumnId,
        },
      });

      const { title, message } = notificationRejectDraft(
        submission.campaign.name,
        MAP_TIMELINE[sub.submissionType.type],
      );

      const notification = await saveNotification({
        userId: sub.userId,
        message: message,
        title: title,
        entity: 'Draft',
        entityId: submission.campaignId,
      });

      io.to(sub.userId).emit('notification', notification);

      return res.status(200).json({ message: 'Succesfully submitted.' });
    }
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const postingSubmission = async (req: Request, res: Response) => {
  const { submissionId, postingLink } = req.body;

  try {
    const submission = await prisma.submission.update({
      where: {
        id: submissionId,
      },
      data: {
        content: postingLink,
        status: 'PENDING_REVIEW',
        submissionDate: dayjs().format(),
      },
      include: {
        campaign: {
          include: {
            campaignAdmin: true,
          },
        },
        user: true,
        task: true,
      },
    });

    const inReviewColumnId = await getColumnId({ userId: submission.userId, columnName: 'In Review' });

    await prisma.task.update({
      where: {
        id: submission.task?.id,
      },
      data: {
        columnId: inReviewColumnId,
      },
    });

    const { title, message } = notificationPosting(submission.campaign.name, 'Creator');

    const { title: adminTitle, message: adminMessage } = notificationPosting(
      submission.campaign.name,
      'Admin',
      submission.user.name as string,
    );

    for (const admin of submission.campaign.campaignAdmin) {
      const notification = await saveNotification({
        userId: admin.adminId,
        message: adminMessage,
        title: adminTitle,
        entity: 'Post',
        entityId: submission.campaignId,
      });

      io.to(clients.get(admin.adminId)).emit('notification', notification);
    }

    const notification = await saveNotification({
      userId: submission.userId,
      message: message,
      title: title,
      entity: 'Post',
      entityId: submission.campaignId,
    });

    io.to(clients.get(submission.userId)).emit('notification', notification);

    return res.status(200).json({ message: 'Successfully submitted' });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const adminManagePosting = async (req: Request, res: Response) => {
  const { status, submissionId } = req.body;

  const userId = req.session.userid;

  try {
    if (status === 'APPROVED') {
      const data = await prisma.submission.update({
        where: {
          id: submissionId,
        },
        data: {
          status: status as SubmissionStatus,
          isReview: true,
        },
        include: {
          user: {
            include: {
              creator: true,
              paymentForm: true,
              creatorAgreement: true,
            },
          },
          campaign: true,
          task: true,
        },
      });

      const doneColumnId = await getColumnId({ userId: data.userId, columnName: 'Done' });

      await prisma.task.update({
        where: {
          id: data.task?.id,
        },
        data: {
          columnId: doneColumnId,
        },
      });

      const invoiceAmount = data.user.creatorAgreement.find((item) => item.userId === data.userId)?.amount;

      const generatedInvoice = status === 'APPROVED' ? createInvoiceService(data, userId, invoiceAmount) : null;

      const shortlistedCreator = await prisma.shortListedCreator.findFirst({
        where: {
          AND: [{ userId: data.userId }, { campaignId: data.campaignId }],
        },
      });

      if (!shortlistedCreator) {
        return res.status(404).json({ message: 'Shortlisted creator not found.' });
      }

      await prisma.shortListedCreator.update({
        where: {
          id: shortlistedCreator.id,
        },
        data: {
          isCampaignDone: true,
        },
      });

      const notification = await saveNotification({
        userId: data.userId,
        message: `Your posting has been approved for campaign ${data.campaign.name}`,
        entity: Entity.Post,
      });

      io.to(clients.get(data.userId)).emit('notification', notification);

      return res.status(200).json({ message: 'Successfully submitted' });
    }

    const data = await prisma.submission.update({
      where: {
        id: submissionId,
      },
      data: {
        status: 'REJECTED',
        isReview: true,
        feedback: {
          upsert: {
            where: {
              id: req.body.feedbackId,
            },
            update: {
              content: req.body.feedback,
              type: 'REASON',
              adminId: userId as string,
            },
            create: {
              content: req.body.feedback,
              type: 'REASON',
              adminId: userId as string,
            },
          },
        },
      },
      include: {
        campaign: true,
      },
    });

    const notification = await saveNotification({
      userId: data.userId,
      message: `Your posting has been rejected for campaign ${data.campaign.name}. Feedback is provided.`,
      entity: Entity.Post,
    });

    io.to(clients.get(data.userId)).emit('notification', notification);

    return res.status(200).json({ message: 'Successfully submitted' });
  } catch (error) {
    console.log(error);
    return res.status(400).json(error);
  }
};

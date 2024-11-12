import e, { Request, Response } from 'express';

import { Entity, Invoice, PrismaClient, SubmissionStatus } from '@prisma/client';
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
  notificationInvoiceGenerate,
  notificationPosting,
  notificationRejectDraft,
} from '@helper/notification';
import { getColumnId } from './kanbanController';

import {
  approvalOfDraft,
  creatorInvoice,
  feedbackOnDraft,
  finalDraftDue,
  firstDraftDue,
  postingSchedule,
} from '@configs/nodemailer.config';

Ffmpeg.setFfmpegPath(FfmpegPath.path);
// Ffmpeg.setFfmpegPath(FfmpegProbe.path);

const prisma = new PrismaClient();

export const agreementSubmission = async (req: Request, res: Response) => {
  const { submissionId } = JSON.parse(req.body.data);

  try {
    if (req.files && req.files.agreementForm) {
      const submission = await prisma.submission.findUnique({
        where: {
          id: submissionId,
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

      if (!submission) {
        return res.status(404).json({ message: 'Submission not found.' });
      }

      const url = await uploadAgreementForm(
        (req.files as any).agreementForm.tempFilePath,
        `${submission.id}.pdf`,
        'agreement',
      );

      await prisma.submission.update({
        where: {
          id: submission.id,
        },
        data: {
          status: 'PENDING_REVIEW',
          content: url as string,
          submissionDate: dayjs().format(),
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

      //for admins
      submission.campaign.campaignAdmin.forEach(async (item) => {
        const adminNotification = await saveNotification({
          userId: item.adminId,
          entity: 'Agreement',
          creatorId: submission.userId,
          entityId: submission.campaignId,
          title: adminTitle,
          message: adminMessage,
        });

        io.to(clients.get(item.adminId)).emit('notification', adminNotification);
        io.to(clients.get(item.adminId)).emit('newSubmission');
      });
    }

    const allSuperadmins = await prisma.user.findMany({
      where: {
        role: 'superadmin',
      },
    });

    for (const admin of allSuperadmins) {
      io.to(clients.get(admin.id)).emit('newSubmission');
    }

    return res.status(200).json({ message: 'Successfully submitted' });
  } catch (error) {
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

      const user = await prisma.user.findUnique({
        where: {
          id: userId,
        },
        select: {
          email: true,
          name: true,
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

      // Emailer for First Draft
      if (user) {
        firstDraftDue(user.email, campaign?.name as string, user.name ?? 'Creator', campaign?.id as string);
      }

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

      await prisma.feedback.create({
        data: {
          content: feedback,
          submissionId: submission.id,
          adminId: req.session.userid as string,
        },
      });

      const notification = await saveNotification({
        userId: userId,
        title: `❌ Agreement Rejected`,
        message: `Please Resubmit Your Agreement Form for ${campaign?.name}`,
        entity: 'Agreement',
        entityId: campaign?.id,
      });

      io.to(clients.get(userId)).emit('notification', notification);
      io.to(clients.get(userId)).emit('newFeedback');
    }

    return res.status(200).json({ message: 'Successfully updated' });
  } catch (error) {
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
        feedback: {
          include: {
            admin: true,
          },
        },
        dependentOn: true,
        dependencies: true,
      },
    });

    return res.status(200).json(data);
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const draftSubmission = async (req: Request, res: Response) => {
  const { submissionId, caption } = JSON.parse(req.body.data);
  const userid = req.session.userid;

  let amqp: amqplib.Connection | null = null;
  let channel: amqplib.Channel | null = null;

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
        campaign: {
          select: {
            campaignAdmin: {
              select: {
                admin: {
                  select: {
                    user: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    const inReviewColumn = await getColumnId({ userId: userid, columnName: 'In Review' });

    await prisma.task.update({
      where: {
        id: submission.task?.id,
      },
      data: {
        columnId: inReviewColumn,
      },
    });

    const file = (req.files as any).draftVideo;

    const filePath = `/tmp/${submissionId}`;
    const compressedFilePath = `/tmp/${submissionId}_compressed.mp4`;

    await file.mv(filePath);

    amqp = await amqplib.connect(process.env.RABBIT_MQ as string);
    channel = await amqp.createChannel();
    await channel.assertQueue('draft');

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
          admins: submission.campaign.campaignAdmin,
        }),
      ),
      {
        persistent: true,
      },
    );

    return res.status(200).json({ message: 'Video start processing' });
  } catch (error) {
    return res.status(400).json(error);
  } finally {
    if (channel) await channel.close();
    if (amqp) await amqp.close();
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
            create: {
              type: 'COMMENT',
              content: feedback,
              adminId: req.session.userid as string,
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

      if (sub.submissionType.type === 'FIRST_DRAFT' && sub.status === 'APPROVED') {
        // Notify about final draft due
        approvalOfDraft(sub.user.email, submission.campaign.name, sub.user.name ?? 'Creator', sub.campaignId);
      } else if ((sub.submissionType.type === 'FINAL_DRAFT' && sub.status === 'APPROVED', sub.campaignId)) {
        // Notify about final draft approval
        approvalOfDraft(sub.user.email, submission.campaign.name, sub.user.name ?? 'Creator', sub.campaignId);
      } else {
        // Fallback email if the draft is not approved
        feedbackOnDraft(sub.user.email, submission.campaign.name, sub.user.name ?? 'Creator', sub.campaignId);
      }

      const posting = await prisma.submission.findFirst({
        where: {
          AND: [
            { userId: sub.userId },
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

      const test = await prisma.submission.update({
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

      // Sending posting schedule
      postingSchedule(
        submission.user.email,
        submission.campaign.name,
        submission.user.name ?? 'Creator',
        submission.campaign.id,
      );

      //For Approve
      const { title, message } = notificationApproveDraft(
        submission.campaign.name,
        MAP_TIMELINE[sub.submissionType.type],
      );

      const notification = await saveNotification({
        userId: submission.userId,
        title: title,
        message: message,
        entity: 'Draft',
        creatorId: submission.userId,
        entityId: submission.campaignId,
      });

      io.to(clients.get(sub.userId)).emit('notification', notification);
      io.to(clients.get(sub.userId)).emit('newFeedback');

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
        include: {
          user: true,
          submissionType: true,
          dependencies: true,
          task: true,
        },
      });

      const doneColumnId = await getColumnId({ userId: sub.userId, columnName: 'Done' });
      const inProgressColumnId = await getColumnId({ userId: sub.userId, columnName: 'In Progress' });

      if (sub.submissionType.type === 'FIRST_DRAFT') {
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

        await prisma.task.update({
          where: {
            id: finalDraft.task?.id,
          },
          data: {
            columnId: inProgressColumnId,
          },
        });
      } else if (sub.submissionType.type === 'FINAL_DRAFT') {
        await prisma.task.update({
          where: {
            id: sub.task?.id,
          },
          data: {
            columnId: inProgressColumnId,
          },
        });
      }

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

      io.to(clients.get(sub.userId)).emit('notification', notification);
      io.to(clients.get(sub.userId)).emit('newFeedback');

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
        creatorId: submission.userId,
        entityId: submission.campaignId,
      });

      io.to(clients.get(admin.adminId)).emit('notification', notification);
      io.to(clients.get(admin.adminId)).emit('newSubmission');
    }

    const notification = await saveNotification({
      userId: submission.userId,
      message: message,
      title: title,
      entity: 'Post',
      entityId: submission.campaignId,
    });

    io.to(clients.get(submission.userId)).emit('notification', notification);

    const allSuperadmins = await prisma.user.findMany({
      where: {
        role: 'superadmin',
      },
    });

    for (const admin of allSuperadmins) {
      io.to(clients.get(admin.id)).emit('newSubmission');
    }

    return res.status(200).json({ message: 'Successfully submitted' });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const adminManagePosting = async (req: Request, res: Response) => {
  const { status, submissionId } = req.body;

  const userId = req.session.userid;

  try {
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
          },
        },
        campaign: {
          include: {
            campaignAdmin: {
              include: {
                admin: {
                  include: {
                    role: true,
                  },
                },
              },
            },
          },
        },
        task: true,
      },
    });

    if (!submission) {
      return res.status(404).json({ message: 'Submission not found.' });
    }

    if (status === 'APPROVED') {
      await prisma.submission.update({
        where: {
          id: submission.id,
        },
        data: {
          status: status as SubmissionStatus,
          isReview: true,
        },
      });

      const doneColumnId = await getColumnId({ userId: submission.userId, columnName: 'Done' });

      await prisma.task.update({
        where: {
          id: submission.task?.id,
        },
        data: {
          columnId: doneColumnId,
        },
      });

      const invoiceAmount = submission.user.creatorAgreement.find(
        (elem) => elem.campaignId === submission.campaign.id,
      )?.amount;

      const invoice: Invoice = await createInvoiceService(submission, userId, invoiceAmount);

      // const generatedInvoice = status === 'APPROVED' ? createInvoiceService(submission, userId, invoiceAmount) : null;

      const shortlistedCreator = await prisma.shortListedCreator.findFirst({
        where: {
          AND: [{ userId: submission.userId }, { campaignId: submission.campaignId }],
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
        userId: submission.userId,
        message: ` ✅ Your posting has been approved for campaign ${submission.campaign.name}`,
        entity: Entity.Post,
        entityId: submission.campaignId,
      });

      io.to(clients.get(submission.userId)).emit('notification', notification);

      const { title, message } = notificationInvoiceGenerate(submission.campaign.name);

      // Notify each admin with the "Finance" role
      for (const admin of submission.campaign.campaignAdmin) {
        if (admin?.admin?.role?.name === 'Finance') {
          console.log('Sending notification to Finance admin:', admin);

          const notification = await saveNotification({
            userId: admin.adminId,
            title,
            message,
            invoiceId: invoice?.id,
            entity: 'Invoice',
            entityId: submission.campaignId,
          });

          io.to(clients.get(admin.adminId)).emit('notification', notification);
        }
      }

      const Invoicenotification = await saveNotification({
        userId: submission.userId,
        title,
        message,
        invoiceId: invoice?.id,
        entity: 'Invoice',
        entityId: submission.campaignId,
      });

      io.to(clients.get(submission.userId)).emit('notification', Invoicenotification);
      io.to(clients.get(submission.userId)).emit('newFeedback');

      //Email
      creatorInvoice(submission.user.email, submission.campaign.name, submission.user.name ?? 'Creator');

      return res.status(200).json({ message: 'Successfully submitted' });
    }

    await prisma.submission.update({
      where: {
        id: submissionId,
      },
      data: {
        status: 'REJECTED',
        isReview: true,
        feedback: {
          create: {
            content: req.body.feedback,
            type: 'REASON',
            adminId: userId as string,
          },
        },
      },
    });

    const notification = await saveNotification({
      userId: submission.userId,
      message: `❌ Your posting has been rejected for campaign ${submission.campaign.name}. Feedback is provided.`,
      entity: Entity.Post,
    });

    io.to(clients.get(submission.userId)).emit('notification', notification);
    io.to(clients.get(submission.userId)).emit('newFeedback');

    return res.status(200).json({ message: 'Successfully submitted' });
  } catch (error) {
    return res.status(400).json(error);
  }
};

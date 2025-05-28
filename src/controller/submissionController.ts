import { Request, Response } from 'express';
import { Entity, FeedbackStatus, PrismaClient, SubmissionStatus } from '@prisma/client';
import { uploadAgreementForm, uploadPitchVideo } from '@configs/cloudStorage.config';
import { saveNotification } from './notificationController';
import { activeProcesses, clients, io } from '../server';
import Ffmpeg from 'fluent-ffmpeg';
import FfmpegPath from '@ffmpeg-installer/ffmpeg';
import amqplib from 'amqplib';
import dayjs from 'dayjs';
import { MAP_TIMELINE } from '@constants/map-timeline';
import { logAdminChange } from '@services/campaignServices';
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
import { createNewRowData } from '@services/google_sheets/sheets';
import { createNewTask, getTaskId, updateTask } from '@services/kanbanService';
import { deductCredits } from '@services/campaignServices';
import {
  getCreatorInvoiceLists,
  handleKanbanSubmission,
  handleSubmissionNotification,
} from '@services/submissionService';

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
              campaignAdmin: {
                select: {
                  adminId: true,
                  admin: {
                    select: {
                      userId: true,
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
          columns: {
            include: {
              task: true,
            },
          },
        },
      });

      if (!boards) {
        return res.status(404).json({ message: 'Board not found' });
      }

      const inReviewColumn = boards.columns.find((column) => column.name === 'In Review');
      const inProgressColumn = boards.columns.find((column) => column.name === 'In Progress');

      const task = inProgressColumn?.task.find((item) => item.submissionId === submission.id);

      await prisma.task.update({
        where: {
          id: task?.id,
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
      for (const item of submission.campaign.campaignAdmin) {
        // get column ID
        const board = await prisma.board.findUnique({
          where: {
            userId: item.admin.userId,
          },
          include: {
            columns: true,
          },
        });

        if (board) {
          const actionNeededColumn = board.columns.find((item) => item.name === 'Actions Needed');
          const agreementTask = await getTaskId({ boardId: board.id, submissionId: submission.id, columnName: 'Done' });

          if (actionNeededColumn) {
            if (!agreementTask) {
              await createNewTask({
                submissionId: submission.id,
                name: 'Agreement Submission',
                userId: item.admin.userId,
                position: 1,
                columnId: actionNeededColumn.id,
              });
            } else {
              await prisma.task.update({
                where: {
                  id: agreementTask.id,
                },
                data: {
                  column: {
                    connect: {
                      id: actionNeededColumn.id,
                    },
                  },
                },
              });
            }
          }
        }

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
      }
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
    console.log(error);
    return res.status(400).json(error);
  }
};

export const adminManageAgreementSubmission = async (req: Request, res: Response) => {
  const data = req.body;

  const adminId = req.session.userid;

  const { campaignId, userId, status, submissionId } = data;
  const nextSubmissionId = data?.submission?.dependencies[0]?.submissionId;

  try {
    const campaign = await prisma.campaign.findUnique({
      where: {
        id: campaignId,
      },
      include: {
        campaignBrief: true,
        campaignAdmin: {
          include: {
            admin: {
              select: {
                userId: true,
              },
            },
          },
        },
      },
    });

    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found' });
    }

    // Creator Board
    const boards = await prisma.board.findFirst({
      where: {
        userId: userId,
      },
      include: {
        columns: {
          include: {
            task: true,
          },
        },
      },
    });

    if (!boards) {
      return res.status(404).json({ message: 'Board not found' });
    }

    const doneColumn = boards.columns.find((column) => column.name === 'Done');
    const inReviewColumn = boards.columns.find((column) => column.name === 'In Review');
    const toDoColumn = boards.columns.find((column) => column.name === 'To Do');
    const inProgressColumn = boards.columns.find((column) => column.name === 'In Progress');

    if (status === 'approve') {
      const agreementSubs = await prisma.submission.update({
        where: {
          id: submissionId,
        },
        data: {
          status: 'APPROVED',
          isReview: true,
          completedAt: new Date(),
          approvedByAdminId: req.session.userid as string,
        },
        include: {
          task: true,
          campaign: {
            include: {
              campaignAdmin: {
                select: {
                  adminId: true,
                  admin: true,
                },
              },
            },
          },
        },
      });

      const taskInReviewColumn = inReviewColumn?.task?.find((item) => item.submissionId === agreementSubs.id);

      if (taskInReviewColumn) {
        await prisma.task.update({
          where: {
            id: taskInReviewColumn.id,
          },
          data: {
            columnId: doneColumn?.id,
          },
        });
      }

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
          nextsubmissionDate: new Date(),
        },
        include: {
          task: true,
        },
      });

      // find by column
      const inProgressTask = submission.task.find((item) => item.columnId === toDoColumn?.id);

      if (inProgressTask) {
        await prisma.task.update({
          where: {
            id: inProgressTask.id,
          },
          data: {
            columnId: inProgressColumn?.id,
          },
        });
      }

      for (const item of agreementSubs.campaign.campaignAdmin) {
        // get column ID
        const board = await prisma.board.findUnique({
          where: {
            userId: item.admin.userId,
          },
          include: {
            columns: {
              include: {
                task: true,
              },
            },
          },
        });

        if (board) {
          const doneColumn = board.columns.find((item) => item.name === 'Done');

          const taskInActionsNeededColumn = await getTaskId({
            boardId: board.id,
            submissionId: agreementSubs.id,
            columnName: 'Actions Needed',
          });

          if (taskInActionsNeededColumn) {
            await updateTask({
              taskId: taskInActionsNeededColumn.id,
              toColumnId: doneColumn?.id as string,
              userId: item.admin.userId,
            });
          }
        }
      }

      // Admin logs for Approve
      if (adminId) {
        const message = `Approved agreement in campaign - ${campaign.name} `;
        logAdminChange(message, adminId, req);
      }

      const { title, message } = notificationApproveAgreement(campaign?.name as string);

      const notification = await saveNotification({
        userId: userId,
        message: message,
        title: title,
        entity: 'Campaign',
        entityId: campaign?.id,
      });

      const image = (campaign.campaignBrief as any).images[0];

      // Emailer for First Draft
      if (user) {
        firstDraftDue(user.email, campaign?.name as string, user.name ?? 'Creator', campaign?.id as string, image);
      }

      io.to(clients.get(userId)).emit('notification', notification);
      io.to(clients.get(userId)).emit('newFeedback');
    } else if (data.status === 'reject') {
      const { feedback, campaignTaskId, submissionId, userId, submission: sub } = data;

      const submission = await prisma.submission.update({
        where: {
          id: submissionId,
        },
        data: {
          status: 'CHANGES_REQUIRED',
          isReview: true,
          completedAt: new Date(),
          approvedByAdminId: req.session.userid as string,
        },
        include: {
          task: true,
          campaign: {
            select: {
              campaignAdmin: {
                select: {
                  admin: {
                    select: {
                      user: {
                        select: {
                          Board: true,
                          id: true,
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

      // For creator from In Review to In progress
      const taskInReviewColumn = await getTaskId({
        boardId: boards.id,
        submissionId: submission.id,
        columnName: 'In Review',
      });

      if (inProgressColumn && taskInReviewColumn) {
        await updateTask({
          taskId: taskInReviewColumn.id,
          toColumnId: inProgressColumn?.id,
          userId: submission.userId,
        });
      }

      // For admin from Actions Needed to Done
      for (const item of submission.campaign.campaignAdmin) {
        // get column ID
        const board = await prisma.board.findUnique({
          where: {
            userId: item.admin.user.id,
          },
          include: {
            columns: {
              include: {
                task: true,
              },
            },
          },
        });

        if (board) {
          const doneColumn = board.columns.find((item) => item.name === 'Done');

          const taskInActionsNeededColumn = await getTaskId({
            boardId: board.id,
            submissionId: submission.id,
            columnName: 'Actions Needed',
          });

          if (taskInActionsNeededColumn) {
            await updateTask({
              taskId: taskInActionsNeededColumn.id,
              toColumnId: doneColumn?.id as string,
              userId: item.admin.user.id,
            });
          }
        }
      }

      await prisma.feedback.create({
        data: {
          content: feedback,
          submissionId: submission.id,
          adminId: req.session.userid as string,
        },
      });

      //Reject Log
      if (adminId) {
        const message = `Rejected agreement in campaign - ${campaign.name} `;
        logAdminChange(message, adminId, req);
      }

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

export const getAllSubmissions = async (req: Request, res: Response) => {
  try {
    const submissions = await prisma.submission.findMany({
      include: {
        submissionType: {
          select: {
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
        rawFootages: true,
        photos: true,
        video: true,
        user: {
          select: {
            name: true,
            email: true,
          },
        },
        admin: {
          select: {
            user: {
              select: {
                name: true,
                email: true,
              },
            },
          },
        },
      },
    });

    // formatting before sending data to frontend
    const formattedSubmissions = submissions.map((submission) => ({
      id: submission.id,
      type: submission.submissionType.type,
      status: submission.status,
      createdAt: submission.createdAt,
      submissionDate: submission.submissionDate,
      completedAt: submission.completedAt,
      nextsubmission: submission.nextsubmissionDate,
      turnaroundTime: submission.completedAt
        ? Math.round((new Date(submission.completedAt).getTime() - new Date(submission.createdAt).getTime()) / 1000)
        : null,
      draftTurnaroundTime:
        submission.completedAt && submission.submissionDate
          ? Math.round(
              (new Date(submission.completedAt).getTime() - new Date(submission.submissionDate).getTime()) / 1000,
            )
          : null,
      creatorAgreementTime:
        submission.createdAt && submission.submissionDate
          ? Math.round(
              (new Date(submission.submissionDate).getTime() - new Date(submission.createdAt).getTime()) / 1000,
            )
          : null,
      creatorDrafTime:
        submission.nextsubmissionDate && submission.submissionDate
          ? Math.round(
              (new Date(submission.submissionDate).getTime() - new Date(submission.nextsubmissionDate).getTime()) /
                1000,
            )
          : null,
      user: submission.user,
      feedback: submission.feedback,
      approvedByAdmin: submission.admin?.user,
    }));

    return res.status(200).json({ submissions: formattedSubmissions });
  } catch (error) {
    console.error('Error fetching submissions:', error);
    return res.status(500).json({ message: 'Failed to retrieve submissions', error });
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
        rawFootages: true,
        photos: true,
        // publicFeedback: true,
        video: true,
      },
    });

    return res.status(200).json(data);
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const draftSubmission = async (req: Request, res: Response) => {
  const { submissionId, caption, photosDriveLink, rawFootagesDriveLink } = JSON.parse(req.body.data);
  const files = req.files as any;
  const userid = req.session.userid;

  // Handle multiple draft videos
  const draftVideos = Array.isArray(files?.draftVideo) ? files.draftVideo : files?.draftVideo ? [files.draftVideo] : [];

  // Handle multiple raw footages
  const rawFootages = Array.isArray(files?.rawFootage) ? files.rawFootage : files?.rawFootage ? [files.rawFootage] : [];

  // Handle multiple photos
  const photos = Array.isArray(files?.photos) ? files.photos : files?.photos ? [files.photos] : [];

  let amqp: amqplib.Connection | null = null;
  let channel: amqplib.Channel | null = null;

  try {
    amqp = await amqplib.connect(process.env.RABBIT_MQ!);

    channel = await amqp.createChannel();

    await channel.assertQueue('draft', { durable: true });

    const submission = await prisma.submission.findUnique({
      where: {
        id: submissionId,
      },
      include: {
        submissionType: true,
        user: {
          include: {
            Board: true,
          },
        },
        campaign: {
          include: {
            campaignAdmin: true,
          },
        },
        feedback: true,
      },
    });

    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    await prisma.submission.update({
      where: { id: submissionId },
      data: {
        ...(photosDriveLink && { photosDriveLink }),
        ...(rawFootagesDriveLink && { rawFootagesDriveLink }),
      },
    });

    // Move task creator from in progress to in review
    if (submission?.user?.Board) {
      const inReviewColumn = await getColumnId({ userId: userid, columnName: 'In Review' });

      const taskInProgress = await getTaskId({
        columnName: 'In Progress',
        boardId: submission.user.Board.id,
        submissionId: submission.id,
      });

      if (taskInProgress && inReviewColumn) {
        await prisma.task.update({
          where: {
            id: taskInProgress.id,
          },
          data: {
            columnId: inReviewColumn,
          },
        });
      }
    }

    const filePaths = new Map();

    if (draftVideos.length) {
      filePaths.set('video', []);
      for (const draftVideo of draftVideos) {
        const draftVideoPath = `/tmp/${submissionId}_${draftVideo.name}`;

        // Move the draft video to the desired path
        await draftVideo.mv(draftVideoPath);

        // Add to filePaths.video array
        filePaths.get('video').push({
          inputPath: draftVideoPath,
          outputPath: `/tmp/${submissionId}_${draftVideo.name.replace('.mp4', '')}_compressed.mp4`,
          fileName: `${submissionId}_${draftVideo.name}`,
        });
      }
    }

    if (rawFootages.length) {
      filePaths.set('rawFootages', []);
      const rawFootageArray = Array.isArray(rawFootages) ? rawFootages : [rawFootages];

      if (rawFootageArray.length) {
        for (const rawFootage of rawFootageArray) {
          const rawFootagePath = `/tmp/${submissionId}_${rawFootage.name}`;
          try {
            await rawFootage.mv(rawFootagePath);
            filePaths.get('rawFootages').push(rawFootagePath);
            // filePaths.rawFootages.push(rawFootagePath);
          } catch (err) {
            console.error('Error moving file:', err);
          }
        }
      }
    }

    if (photos.length) {
      filePaths.set('photos', []);
      for (const photo of photos) {
        const photoPath = `/tmp/${submissionId}_${photo.name}`;
        await photo.mv(photoPath);
        filePaths.get('photos').push(photoPath);
      }
    }

    // amqp = await amqplib.connect(process.env.RABBIT_MQ as string);

    const isSent = channel.sendToQueue(
      'draft',
      Buffer.from(
        JSON.stringify({
          userid,
          submissionId,
          campaignId: submission?.campaignId,
          folder: submission?.submissionType.type,
          caption,
          admins: submission.campaign.campaignAdmin,
          filePaths: Object.fromEntries(filePaths),
        }),
      ),
      { persistent: true },
    );

    console.log('SENDING TO', process.env.RABBIT_MQ);

    activeProcesses.set(submissionId, { status: 'queue' });

    // await channel.close();
    // await amqp.close();

    return res.status(200).json({ message: 'Video start processing' });
  } catch (error) {
    console.log(error);
    return res.status(400).json(error);
  } finally {
    if (channel) await channel.close();
    if (amqp) await amqp.close();
  }
};

export const adminManageDraft = async (req: Request, res: Response) => {
  const { submissionId, feedback, type, reasons, userId, dueDate, sectionOnly } = req.body;

  try {
    const submission = await prisma.submission.findUnique({
      where: {
        id: submissionId,
      },
      include: {
        feedback: true,
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
                    user: {
                      select: {
                        Board: true,
                        id: true,
                      },
                    },
                  },
                },
              },
            },
            campaignBrief: true,
          },
        },
        submissionType: true,
        task: true,
      },
    });

    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    if (type === 'approve') {
      // Start a transaction to ensure all updates are atomic
      const result = await prisma.$transaction(async (tx) => {
        const approveSubmission = await tx.submission.update({
          where: {
            id: submission?.id,
          },
          data: {
            status: sectionOnly ? submission.status : 'APPROVED',
            isReview: true,
            completedAt: new Date(),
            approvedByAdminId: req.session.userid as string,
            dueDate: dueDate ? new Date(dueDate) : undefined,
            feedback: feedback && {
              create: {
                type: 'COMMENT',
                content: feedback,
                adminId: req.session.userid as string,
              },
            },
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
            campaign: {
              include: {
                campaignBrief: true,
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
            submissionType: true,
            task: true,
          },
        });

        // If this is a first draft being approved, find and update the final draft
        if (submission.submissionType.type === 'FIRST_DRAFT' && !sectionOnly) {
          const finalDraft = await tx.submission.findFirst({
            where: {
              userId: submission.userId,
              campaignId: submission.campaignId,
              submissionType: {
                type: 'FINAL_DRAFT',
              },
            },
          });

          if (finalDraft) {
            if (finalDraft.status !== 'APPROVED' && finalDraft.status !== 'NOT_STARTED') {
              await tx.submission.update({
                where: { id: finalDraft.id },
                data: { status: 'NOT_STARTED' },
              });
            }
          }
        }

        // If dueDate is provided, also update the posting submission if it exists
        if (dueDate) {
          const postingSubmission = await tx.submission.findFirst({
            where: {
              userId: submission.userId,
              campaignId: submission.campaignId,
              submissionType: {
                type: 'POSTING',
              },
            },
          });

          if (postingSubmission) {
            await tx.submission.update({
              where: { id: postingSubmission.id },
              data: {
                dueDate: new Date(dueDate),
                startDate: new Date(dueDate),
                endDate: new Date(dueDate),
              },
            });
          }
        }

        const doneColumnId = await getColumnId({ userId: submission.userId, columnName: 'Done' });

        // Move task from column In Review to Done
        if (approveSubmission.user.Board) {
          const task = await getTaskId({
            boardId: approveSubmission?.user.Board.id,
            submissionId: approveSubmission.id,
            columnName: 'In Review',
          });

          if (task && doneColumnId) {
            await tx.task.update({
              where: {
                id: task.id,
              },
              data: {
                columnId: doneColumnId,
              },
            });
          }
        }

        return approveSubmission;
      });

      const image: any = submission?.campaign?.campaignBrief?.images || [];

      if (submission.submissionType.type === 'FIRST_DRAFT' && submission.status === 'APPROVED') {
        // Notify about final draft due
        approvalOfDraft(
          submission.user.email,
          submission.campaign.name,
          submission.user.name ?? 'Creator',
          submission.campaignId,
          image[0],
        );
      } else if (
        (submission.submissionType.type === 'FINAL_DRAFT' && submission.status === 'APPROVED', submission.campaignId)
      ) {
        // Notify about final draft approval
        approvalOfDraft(
          submission.user.email,
          submission.campaign.name,
          submission.user.name ?? 'Creator',
          submission.campaignId,
          image[0],
        );
      } else {
        // Fallback email if the draft is not approved
        feedbackOnDraft(
          submission.user.email,
          submission.campaign.name,
          submission.user.name ?? 'Creator',
          submission.campaignId,
        );
      }

      // Generate invoice after draft is approve if campaign is ugc and No posting submission
      if (submission.campaign.campaignType == 'ugc') {
        const invoiceAmount = submission.user.creatorAgreement.find(
          (elem: any) => elem.campaignId === submission.campaign.id,
        )?.amount;

        const invoice = await createInvoiceService(submission, userId, invoiceAmount);

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
      }

      return res.status(200).json({ message: 'Draft approved successfully', submission: result });
    } else {
      const sub = await prisma.submission.update({
        where: {
          id: submissionId,
        },
        data: {
          status: 'CHANGES_REQUIRED',
          isReview: true,
          completedAt: new Date(),
          approvedByAdminId: req.session.userid as string,
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
          user: {
            include: {
              Board: true,
            },
          },
          campaign: {
            select: {
              campaignAdmin: {
                select: {
                  admin: {
                    select: {
                      user: {
                        select: {
                          Board: true,
                          id: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          submissionType: true,
          dependencies: true,
          task: true,
        },
      });

      const doneColumnId = await getColumnId({ userId: sub.userId, columnName: 'Done' });
      const inReviewId = await getColumnId({ userId: sub.userId, columnName: 'In Review' });
      const inProgressColumnId = await getColumnId({ userId: sub.userId, columnName: 'In Progress' });
      const toDoColumnId = await getColumnId({ userId: sub.userId, columnName: 'To Do' });

      const inReviewColumn = await prisma.columns.findUnique({
        where: {
          id: inReviewId!,
        },
        include: {
          task: true,
        },
      });

      const taskInReview = inReviewColumn?.task.find((item) => item.submissionId === sub.id);

      if (sub.submissionType.type === 'FIRST_DRAFT') {
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
            id: sub.dependencies[0].submissionId as string,
          },
          data: {
            status: 'IN_PROGRESS',
            nextsubmissionDate: new Date(),
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

          if (finalDraft) {
            await prisma.task.update({
              where: {
                id: finalDraft?.id,
              },
              data: {
                columnId: inProgressColumnId!,
              },
            });
          }
        }
      } else if (sub.submissionType.type === 'FINAL_DRAFT') {
        // Move task from column In Review to In progress
        const finalDraftTaskId = await getTaskId({
          boardId: sub?.user?.Board?.id as any,
          submissionId: sub.id,
          columnName: 'In Review',
        });

        if (finalDraftTaskId) {
          await updateTask({
            taskId: finalDraftTaskId.id as any,
            toColumnId: inProgressColumnId as any,
            userId: sub.userId,
          });
        }
      }

      // Manage task draft kanban for admin
      for (const item of sub.campaign.campaignAdmin) {
        if (item.admin.user.Board) {
          const task = await getTaskId({
            boardId: item.admin.user.Board?.id,
            columnName: 'Actions Needed',
            submissionId: sub.id,
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
    console.log(error);
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
          select: {
            campaignAdmin: {
              select: {
                adminId: true,
                admin: {
                  select: {
                    user: {
                      select: {
                        Board: true,
                        id: true,
                      },
                    },
                  },
                },
              },
            },
            name: true,
          },
        },
        user: true,
        task: true,
      },
    });

    const inReviewColumnId = await getColumnId({ userId: submission.userId, columnName: 'In Review' });
    const inProgress = await getColumnId({ userId: submission.userId, columnName: 'In Progress' });

    const taskInProgress = submission.task.find((item) => item.columnId === inProgress);

    // Move from column In Progress to In review
    if (taskInProgress && inReviewColumnId) {
      await prisma.task.update({
        where: {
          id: taskInProgress?.id,
        },
        data: {
          columnId: inReviewColumnId,
        },
      });
    }

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

      if (admin?.admin.user.Board) {
        const column = await getColumnId({
          userId: admin.admin.user.id,
          boardId: admin.admin.user.Board.id,
          columnName: 'Actions Needed',
        });

        if (column) {
          await createNewTask({
            submissionId: submission.id,
            name: 'Posting Submission',
            columnId: column,
            userId: admin.admin.user.id,
            position: 0,
          });
        }
      }

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

export const changePostingDate = async (req: Request, res: Response) => {
  const { startDate, endDate, submissionId } = req.body;

  try {
    const data = await prisma.submission.update({
      where: {
        id: submissionId,
      },
      data: {
        startDate: startDate,
        endDate: endDate,
        dueDate: endDate,
      },
    });

    return res.status(200).json({ message: 'Posting date changed successfully.' });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const adminManagePosting = async (req: Request, res: Response) => {
  const { status, submissionId } = req.body;
  const userId = req.session.userid;

  try {
    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        user: {
          include: { creator: true, paymentForm: true, creatorAgreement: true, Board: true },
        },
        campaign: {
          include: {
            campaignBrief: true,
            campaignAdmin: {
              include: {
                admin: {
                  select: {
                    role: true,
                    user: { select: { Board: true, id: true } },
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

    const inReviewColumn = await getColumnId({ userId: submission?.userId, columnName: 'In Review' });
    const doneColumnId = await getColumnId({ userId: submission?.userId, columnName: 'Done' });
    const taskInReview = submission.task.find((item) => item.columnId === inReviewColumn);

    await prisma.$transaction(async (tx) => {
      if (status === 'APPROVED') {
        const approvedSubmission = await tx.submission.update({
          where: { id: submission.id },
          data: {
            status: status as SubmissionStatus,
            isReview: true,
            completedAt: new Date(),
            approvedByAdminId: userId as string,
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
            campaign: {
              include: {
                campaignBrief: true,
                campaignAdmin: {
                  include: {
                    admin: {
                      select: {
                        role: true,
                        user: {
                          select: {
                            Board: true,
                            id: true,
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            task: true,
          },
        });

        if (submission.campaign.campaignCredits !== null) {
          await deductCredits(approvedSubmission.campaignId, approvedSubmission.userId, tx as PrismaClient);
        }

        if (taskInReview && doneColumnId) {
          await tx.task.update({
            where: { id: taskInReview.id },
            data: { columnId: doneColumnId },
          });
        }

        const invoiceAmount = submission.user.creatorAgreement.find(
          (elem) => elem.campaignId === submission.campaign.id,
        )?.amount;

        const invoiceItems = await getCreatorInvoiceLists(approvedSubmission.id, tx as PrismaClient);

        await createInvoiceService(approvedSubmission, userId, invoiceAmount, invoiceItems);

        const shortlistedCreator = await tx.shortListedCreator.findFirst({
          where: { userId: approvedSubmission.userId, campaignId: submission.campaignId },
        });

        if (!shortlistedCreator) {
          throw new Error('Shortlisted creator not found.');
        }

        await tx.shortListedCreator.update({
          where: { id: shortlistedCreator.id },
          data: { isCampaignDone: true },
        });

        await saveNotification({
          userId: submission.userId,
          message: ` ✅ Your posting has been approved for campaign ${submission.campaign.name}`,
          entity: Entity.Post,
          entityId: submission.campaignId,
        });
      } else {
        await tx.submission.update({
          where: { id: submission.id },
          data: {
            status: 'REJECTED',
            isReview: true,
            feedback: {
              create: { content: req.body.feedback, type: 'REASON', adminId: userId },
            },
          },
        });

        if (submission.user.Board) {
          const inProgressColumn = await getColumnId({
            userId: submission.userId,
            boardId: submission.user.Board.id,
            columnName: 'In Progress',
          });

          const taskInReview = await getTaskId({
            boardId: submission.user.Board.id,
            submissionId: submission.id,
            columnName: 'In Review',
          });

          if (taskInReview) {
            await updateTask({
              taskId: taskInReview.id,
              toColumnId: inProgressColumn as any,
              userId: submission.userId,
            });
          }
        }

        for (const item of submission.campaign.campaignAdmin) {
          if (item.admin.user.Board) {
            const taskInActionsNeeded = await getTaskId({
              boardId: item.admin.user.Board.id,
              columnName: 'Actions Needed',
              submissionId: submission.id,
            });

            if (taskInActionsNeeded) {
              await prisma.task.delete({
                where: {
                  id: taskInActionsNeeded.id,
                },
              });
            }
          }
        }

        const notification = await saveNotification({
          userId: submission.userId,
          message: `❌ Your posting has been rejected for campaign ${submission.campaign.name}. Feedback is provided.`,
          entity: Entity.Post,
        });

        io.to(clients.get(submission.userId)).emit('notification', notification);
        io.to(clients.get(submission.userId)).emit('newFeedback');
      }
    });

    return res.status(200).json({ message: 'Successfully submitted' });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
};

export const adminManagePhotos = async (req: Request, res: Response) => {
  const { photos, submissionId, photoFeedback, type, sectionOnly } = req.body;

  if (!photos.length) return res.status(404).json({ message: 'At least one photo is required' });

  try {
    const submission = await prisma.submission.findUnique({
      where: {
        id: submissionId,
      },
      select: {
        id: true,
        videos: true,
        submissionType: true,
        userId: true,
        status: true,
        feedback: {
          orderBy: {
            createdAt: 'desc',
          },
        },
        campaignId: true,
      },
    });

    if (!submission) return res.status(404).json({ message: 'Submission not found' });

    // Update photo status based on action type
    await prisma.photo.updateMany({
      where: {
        campaignId: submission.campaignId,
        userId: submission.userId,
        id: { in: photos },
      },
      data: {
        status: type === 'approve' ? 'APPROVED' : 'REVISION_REQUESTED',
      },
    });

    // If sectionOnly flag is present, don't change submission status for either approve or request
    if (sectionOnly) {
      // Just update the photo status, don't change submission status
      if (submission.status === 'CHANGES_REQUIRED' && submission.feedback.length && type === 'request') {
        // Update existing feedback if already in CHANGES_REQUIRED state
        const feedbackId = submission.feedback[0].id;

        await prisma.feedback.update({
          where: {
            id: feedbackId,
          },
          data: {
            photoContent: photoFeedback,
            submissionId: submission.id,
            adminId: req.session.userid,
            photosToUpdate: {
              push: photos,
            },
          },
        });
      } else {
        // Add new feedback without changing submission status
        await prisma.feedback.create({
          data: {
            photoContent: photoFeedback,
            adminId: req.session.userid,
            submissionId: submission.id,
            type: type === 'approve' ? 'COMMENT' : 'REQUEST',
            ...(type === 'request' && { photosToUpdate: photos }),
          },
        });
      }
    }
    // Handle approve without sectionOnly flag
    else if (type === 'approve') {
      // Update submission status to APPROVED
      await prisma.submission.update({
        where: {
          id: submission.id,
        },
        data: {
          status: 'APPROVED',
          completedAt: new Date(),
          approvedByAdminId: req.session.userid as string,
          feedback: photoFeedback
            ? {
                create: {
                  photoContent: photoFeedback,
                  adminId: req.session.userid,
                  type: 'COMMENT',
                },
              }
            : undefined,
        },
      });

      // Update kanban board for full approvals
      await handleKanbanSubmission(submission.id);
    }
    // Handle request changes flow without sectionOnly
    else if (type === 'request') {
      if (submission.status === 'CHANGES_REQUIRED' && submission.feedback.length) {
        // get existing feedbacks
        const feedbackId = submission.feedback[0].id;

        await prisma.feedback.update({
          where: {
            id: feedbackId,
          },
          data: {
            photoContent: photoFeedback,
            submissionId: submission.id,
            adminId: req.session.userid,
            photosToUpdate: {
              push: photos,
            },
          },
        });
      } else {
        await prisma.submission.update({
          where: {
            id: submission.id,
          },
          data: {
            completedAt: new Date(),
            approvedByAdminId: req.session.userid as string,
            status: 'CHANGES_REQUIRED',
            feedback: {
              create: {
                photoContent: photoFeedback,
                adminId: req.session.userid,
                photosToUpdate: photos,
                type: 'REQUEST',
              },
            },
          },
        });
      }

      // Update kanban board for full change requests
      await handleKanbanSubmission(submission.id);
    }

    // Send notifications regardless of sectionOnly flag
    const notification = await handleSubmissionNotification(submission.id);
    io.to(clients.get(submission.userId)).emit('notification', notification);
    io.to(clients.get(submission.userId)).emit('newFeedback');

    return res.status(200).json({
      message: type === 'approve' ? 'Photos approved successfully' : 'Changes requested successfully',
    });
  } catch (error) {
    console.error('Error in adminManagePhotos:', error);
    return res.status(400).json({ message: error.message || 'Error updating photos' });
  }
};

export const adminManageVideos = async (req: Request, res: Response) => {
  const { videos, submissionId, feedback, reasons, type, sectionOnly, dueDate } = req.body;
  try {
    if (type && type === 'approve') {
      // If sectionOnly flag is present, don't change the overall submission status
      if (sectionOnly) {
        await prisma.$transaction(async (tx) => {
          const submission = await tx.submission.findUnique({
            where: {
              id: submissionId,
            },
            include: {
              user: true,
              video: true,
            },
          });

          if (!submission) throw new Error('Submission not found');

          // Just mark the videos as approved
          const videoIds = videos.length ? videos : submission.video.map((v) => v.id);

          await tx.video.updateMany({
            where: {
              id: { in: videoIds },
              userId: submission.userId,
              campaignId: submission.campaignId,
            },
            data: {
              status: 'APPROVED',
            },
          });

          // Add feedback if provided but don't change submission status
          if (feedback) {
            await tx.feedback.create({
              data: {
                content: feedback,
                type: 'COMMENT',
                adminId: req.session.userid as string,
                submissionId: submission.id,
              },
            });
          }

          // If dueDate is provided, store it on the submission for future use
          if (dueDate) {
            // Find or create a posting submission for this creator
            const postingSubmission = await tx.submission.findFirst({
              where: {
                userId: submission.userId,
                campaignId: submission.campaignId,
                submissionType: {
                  type: 'POSTING',
                },
              },
            });

            if (postingSubmission) {
              // Update the due date on the posting submission
              await tx.submission.update({
                where: { id: postingSubmission.id },
                data: { dueDate: new Date(dueDate) },
              });
            }

            // Also store due date on the current submission as reference
            await tx.submission.update({
              where: { id: submission.id },
              data: { dueDate: new Date(dueDate) },
            });
          }

          return submission;
        });

        return res.status(200).json({ message: 'Videos approved successfully' });
      }

      // Original full approval flow (when sectionOnly is not present)
      await prisma.$transaction(async (tx) => {
        const approveSubmission = await tx.submission.update({
          where: {
            id: submissionId,
          },
          data: {
            status: 'APPROVED',
            isReview: true,
            completedAt: new Date(),
            approvedByAdminId: req.session.userid as string,
            feedback: feedback && {
              create: {
                type: 'COMMENT',
                content: feedback,
                adminId: req.session.userid as string,
              },
            },
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
            campaign: {
              include: {
                campaignBrief: true,
                campaignAdmin: {
                  include: {
                    admin: {
                      include: {
                        role: true,
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

            submissionType: true,
            task: true,
            video: true,
          },
        });

        const videoDeliverables = await tx.video.findMany({
          where: {
            userId: approveSubmission.userId,
            campaignId: approveSubmission.campaignId,
          },
        });

        if (!videos.length) {
          await tx.video.updateMany({
            where: { id: { in: videoDeliverables.map((x) => x.id) } },
            data: {
              status: 'APPROVED',
            },
          });
        }

        const doneColumnId = await getColumnId({ userId: approveSubmission.userId, columnName: 'Done' });

        if (approveSubmission.user.Board) {
          const task = await getTaskId({
            boardId: approveSubmission?.user.Board.id,
            submissionId: approveSubmission.id,
            columnName: 'In Review',
          });

          if (task && doneColumnId) {
            await tx.task.update({
              where: {
                id: task.id,
              },
              data: {
                columnId: doneColumnId,
              },
            });
          }
        }

        const image: any = approveSubmission?.campaign?.campaignBrief?.images || [];

        if (approveSubmission.submissionType.type === 'FIRST_DRAFT' && approveSubmission.status === 'APPROVED') {
          approvalOfDraft(
            approveSubmission.user.email,
            approveSubmission.campaign.name,
            approveSubmission.user.name ?? 'Creator',
            approveSubmission.campaignId,
            image[0],
          );
        } else if (
          (approveSubmission.submissionType.type === 'FINAL_DRAFT' && approveSubmission.status === 'APPROVED',
          approveSubmission.campaignId)
        ) {
          approvalOfDraft(
            approveSubmission.user.email,
            approveSubmission.campaign.name,
            approveSubmission.user.name ?? 'Creator',
            approveSubmission.campaignId,
            image[0],
          );
        } else {
          feedbackOnDraft(
            approveSubmission.user.email,
            approveSubmission.campaign.name,
            approveSubmission.user.name ?? 'Creator',
            approveSubmission.campaignId,
          );
        }

        if (approveSubmission.campaign.campaignType == 'ugc') {
          const invoiceAmount = approveSubmission.user.creatorAgreement.find(
            (elem: any) => elem.campaignId === approveSubmission.campaign.id,
          )?.amount;

          if (approveSubmission.campaign.campaignCredits !== null) {
            await deductCredits(approveSubmission.campaignId, approveSubmission.userId, tx as PrismaClient);
          }

          const invoiceItems = await getCreatorInvoiceLists(approveSubmission.id, tx as PrismaClient);

          await createInvoiceService(approveSubmission, approveSubmission.userId, invoiceAmount, invoiceItems);

          const shortlistedCreator = await tx.shortListedCreator.findFirst({
            where: {
              AND: [{ userId: approveSubmission.userId }, { campaignId: approveSubmission.campaignId }],
            },
          });

          if (!shortlistedCreator) {
            throw new Error('Shortlisted creator not found.');
          }

          await tx.shortListedCreator.update({
            where: {
              id: shortlistedCreator.id,
            },
            data: {
              isCampaignDone: true,
            },
          });
        }

        if (approveSubmission.campaign.campaignType === 'normal') {
          const posting = await tx.submission.findFirst({
            where: {
              AND: [
                { userId: approveSubmission.userId },
                { campaignId: approveSubmission.campaignId },
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
              user: {
                include: {
                  Board: {
                    include: {
                      columns: {
                        include: {
                          task: true,
                        },
                      },
                    },
                  },
                },
              },
              task: true,
              campaign: {
                select: {
                  campaignBrief: {
                    select: {
                      images: true,
                    },
                  },
                },
              },
            },
          });

          if (!posting) {
            throw new Error('Submission called posting not found.');
          }

          const inProgressColumnId = await getColumnId({ userId: posting.userId, columnName: 'In Progress' });
          const toDoColumn = posting.user.Board?.columns.find((item) => item.name === 'To Do');

          const task = toDoColumn?.task.find((item) => item.submissionId === posting.id);

          if (task && inProgressColumnId) {
            await tx.task.update({
              where: {
                id: task?.id,
              },
              data: {
                columnId: inProgressColumnId,
              },
            });
          }

          // For posting
          await tx.submission.update({
            where: {
              id: posting.id,
            },
            data: {
              status: 'IN_PROGRESS',
              nextsubmissionDate: new Date(),
              startDate: dayjs(req.body.schedule.startDate).format(),
              endDate: dayjs(req.body.schedule.endDate).format(),
              dueDate: dayjs(req.body.schedule.endDate).format(),
            },
          });

          const images: any = posting.campaign.campaignBrief?.images;

          postingSchedule(
            approveSubmission.user.email,
            approveSubmission.campaign.name,
            approveSubmission.user.name ?? 'Creator',
            approveSubmission.campaign.id,
            images[0],
          );
        }

        for (const item of approveSubmission.campaign.campaignAdmin) {
          if (item.admin.user.Board) {
            const taskInActionsNeeded = await getTaskId({
              boardId: item.admin.user.Board?.id,
              columnName: 'Actions Needed',
              submissionId: approveSubmission.id,
            });

            const columnDone = await getColumnId({
              userId: item.admin.userId,
              boardId: item.admin.user.Board.id,
              columnName: 'Done',
            });

            if (taskInActionsNeeded && columnDone) {
              await tx.task.update({
                where: {
                  id: taskInActionsNeeded.id,
                },
                data: {
                  column: { connect: { id: columnDone } },
                },
              });
            }
          }
        }

        const { title, message } = notificationApproveDraft(
          approveSubmission.campaign.name,
          MAP_TIMELINE[approveSubmission.submissionType.type],
        );

        const notification = await saveNotification({
          userId: approveSubmission.userId,
          title: title,
          message: message,
          entity: 'Draft',
          creatorId: approveSubmission.userId,
          entityId: approveSubmission.campaignId,
        });

        io.to(clients.get(approveSubmission.userId)).emit('notification', notification);
        io.to(clients.get(approveSubmission.userId)).emit('newFeedback');
      });

      return res.status(200).json({ message: 'Successfully submitted' });
    }

    if (!videos.length) return res.status(404).json({ message: 'At least one photo is required' });

    await prisma.$transaction(async (tx) => {
      const submission = await tx.submission.findUnique({
        where: {
          id: submissionId,
        },
        include: {
          video: true,
          submissionType: true,
          dependencies: true,
          campaign: {
            select: {
              name: true,
              campaignAdmin: {
                select: {
                  admin: {
                    select: {
                      role: true,
                      userId: true,
                    },
                  },
                },
              },
            },
          },
          user: {
            select: {
              Board: true,
            },
          },
          feedback: {
            orderBy: {
              createdAt: 'desc',
            },
          },
        },
      });

      if (!submission) throw new Error('Submission not found');

      // Mark selected videos for revision
      await tx.video.updateMany({
        where: {
          userId: submission.userId,
          campaignId: submission.campaignId,
          id: { in: videos },
        },
        data: {
          status: 'REVISION_REQUESTED',
        },
      });

      // Mark non-selected videos as approved
      await tx.video.updateMany({
        where: {
          userId: submission.userId,
          campaignId: submission.campaignId,
          id: { notIn: videos },
        },
        data: {
          status: 'APPROVED',
        },
      });

      // If sectionOnly flag is present, don't change the overall submission status
      if (sectionOnly) {
        // Just add feedback record without changing submission status
        if (submission.status === 'CHANGES_REQUIRED' && submission.feedback.length) {
          // Update existing feedback if already in CHANGES_REQUIRED state
          const feedbackId = submission.feedback[0].id;

          await tx.feedback.update({
            where: {
              id: feedbackId,
            },
            data: {
              content: feedback,
              reasons: reasons,
              submissionId: submission.id,
              videosToUpdate: {
                push: videos,
              },
            },
          });
        } else {
          // Create new feedback without changing submission status
          await tx.feedback.create({
            data: {
              content: feedback,
              reasons: reasons,
              adminId: req.session.userid,
              videosToUpdate: videos,
              submissionId: submission.id,
              type: 'COMMENT',
            },
          });
        }
      } else {
        // Original behavior for changing overall status
        if (submission.status === 'CHANGES_REQUIRED' && submission.feedback.length) {
          // get existing feedbacks
          const feedbackId = submission.feedback[0].id;

          await tx.feedback.update({
            where: {
              id: feedbackId,
            },
            data: {
              content: feedback,
              reasons: reasons,
              submissionId: submission.id,
              videosToUpdate: {
                push: videos,
              },
            },
          });
        } else {
          await tx.submission.update({
            where: {
              id: submission.id,
            },
            data: {
              ...(submission.status !== 'CHANGES_REQUIRED' && {
                status: 'CHANGES_REQUIRED',
              }),
              completedAt: new Date(),
              approvedByAdminId: req.session.userid as string,
              feedback: {
                create: {
                  content: feedback,
                  reasons: reasons,
                  adminId: req.session.userid,
                  videosToUpdate: videos,
                },
              },
            },
          });
        }

        await handleKanbanSubmission(submission.id);
      }

      // Send notifications regardless of sectionOnly flag
      const notification = await handleSubmissionNotification(submission.id);
      io.to(clients.get(submission.userId)).emit('notification', notification);
      io.to(clients.get(submission.userId)).emit('newFeedback');
    });

    return res.status(200).json({ message: 'Successfully submitted' });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const adminManageFinalDraft = async (req: Request, res: Response) => {
  const { videos, submissionId, feedback, reasons, type, sectionOnly, dueDate } = req.body;
  const userId = req.session.userid;

  try {
    console.log('=== adminManageFinalDraft START ===');
    console.log('Request params:', { type, sectionOnly, videos: videos?.length });

    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        user: {
          include: { creator: true, paymentForm: true, creatorAgreement: true, Board: true },
        },
        campaign: {
          include: {
            campaignBrief: true,
            campaignAdmin: {
              include: {
                admin: {
                  select: {
                    role: true,
                    user: { select: { Board: true, id: true } },
                  },
                },
              },
            },
          },
        },
        task: true,
        video: true,
        submissionType: true,
      },
    });

    if (!submission) {
      return res.status(404).json({ message: 'Submission not found.' });
    }

    console.log('Current submission status:', submission.status);
    console.log('Submission type:', submission.submissionType?.type);

    const inReviewColumn = await getColumnId({ userId: submission?.userId, columnName: 'In Review' });
    const doneColumnId = await getColumnId({ userId: submission?.userId, columnName: 'Done' });
    const taskInReview = submission.task.find((item) => item.columnId === inReviewColumn);

    await prisma.$transaction(async (tx) => {
      if (type === 'approve') {
        console.log('Processing approval...');
        // If sectionOnly flag is present, only update the videos
        if (sectionOnly) {
          console.log('Section only approval flow');
          const videoIds = videos.length ? videos : submission.video.map((v) => v.id);

          await tx.video.updateMany({
            where: {
              id: { in: videoIds },
              userId: submission.userId,
              campaignId: submission.campaignId,
            },
            data: {
              status: 'APPROVED',
            },
          });

          // Add feedback if provided
          if (feedback) {
            await tx.feedback.create({
              data: {
                content: feedback,
                type: 'COMMENT',
                adminId: userId as string,
                submissionId: submission.id,
              },
            });
          }

          // Check if all sections are now approved
          const allVideos = await tx.video.findMany({
            where: {
              userId: submission.userId,
              campaignId: submission.campaignId,
            },
          });

          const allSectionsApproved = allVideos.every((v) => v.status === 'APPROVED');
          console.log('All sections approved?', allSectionsApproved);

          // If all sections are approved, update the final draft status
          if (allSectionsApproved) {
            console.log('Updating final draft status to APPROVED');
            await tx.submission.update({
              where: { id: submission.id },
              data: {
                status: 'APPROVED',
                isReview: true,
                completedAt: new Date(),
                approvedByAdminId: userId as string,
              },
            });

            // Find and update the posting submission
            const postingSubmission = await tx.submission.findFirst({
              where: {
                userId: submission.userId,
                campaignId: submission.campaignId,
                submissionType: {
                  type: 'POSTING',
                },
              },
            });

            if (postingSubmission) {
              console.log('Found posting submission:', postingSubmission.id);
              console.log('Current posting status:', postingSubmission.status);
              const postingDueDate = dueDate ? new Date(dueDate) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
              await tx.submission.update({
                where: { id: postingSubmission.id },
                data: {
                  status: 'IN_PROGRESS',
                  dueDate: postingDueDate,
                  startDate: postingDueDate,
                  endDate: postingDueDate,
                },
              });
              console.log('Updated posting submission to IN_PROGRESS');
            }

            if (taskInReview && doneColumnId) {
              await tx.task.update({
                where: { id: taskInReview.id },
                data: { columnId: doneColumnId },
              });
            }

            // Send notification
            await saveNotification({
              userId: submission.userId,
              message: `✅ Your final draft has been approved for campaign ${submission.campaign.name}`,
              entity: Entity.Draft,
              entityId: submission.campaignId,
            });
          }
        } else {
          console.log('Full approval flow');
          // Full approval flow
          const approvedSubmission = await tx.submission.update({
            where: { id: submission.id },
            data: {
              status: 'APPROVED',
              isReview: true,
              completedAt: new Date(),
              approvedByAdminId: userId as string,
              ...(dueDate && { dueDate: new Date(dueDate) }),
              feedback: feedback && {
                create: {
                  type: 'COMMENT',
                  content: feedback,
                  adminId: userId as string,
                },
              },
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
              campaign: {
                include: {
                  campaignBrief: true,
                  campaignAdmin: {
                    include: {
                      admin: {
                        select: {
                          role: true,
                          user: {
                            select: {
                              Board: true,
                              id: true,
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
              task: true,
              video: true,
            },
          });

          console.log('Updated submission status:', approvedSubmission.status);

          // Update all videos to approved
          const videoDeliverables = await tx.video.findMany({
            where: {
              userId: approvedSubmission.userId,
              campaignId: approvedSubmission.campaignId,
            },
          });

          if (!videos.length) {
            await tx.video.updateMany({
              where: { id: { in: videoDeliverables.map((x) => x.id) } },
              data: {
                status: 'APPROVED',
              },
            });
          }

          // Find and update the posting submission
          const postingSubmission = await tx.submission.findFirst({
            where: {
              userId: approvedSubmission.userId,
              campaignId: approvedSubmission.campaignId,
              submissionType: {
                type: 'POSTING',
              },
            },
          });

          if (postingSubmission) {
            console.log('Found posting submission:', postingSubmission.id);
            console.log('Current posting status:', postingSubmission.status);
            const postingDueDate = dueDate ? new Date(dueDate) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
            await tx.submission.update({
              where: { id: postingSubmission.id },
              data: {
                status: 'IN_PROGRESS',
                dueDate: postingDueDate,
                startDate: postingDueDate,
                endDate: postingDueDate,
              },
            });
            console.log('Updated posting submission to IN_PROGRESS');
          }

          if (taskInReview && doneColumnId) {
            await tx.task.update({
              where: { id: taskInReview.id },
              data: { columnId: doneColumnId },
            });
          }

          // Send notification
          await saveNotification({
            userId: submission.userId,
            message: `✅ Your final draft has been approved for campaign ${submission.campaign.name}`,
            entity: Entity.Draft,
            entityId: submission.campaignId,
          });
        }
      } else if (type === 'request') {
        console.log('Processing request changes...');
        // Handle request changes flow
        await tx.submission.update({
          where: { id: submission.id },
          data: {
            status: 'CHANGES_REQUIRED',
            isReview: true,
            feedback: {
              create: { content: feedback, type: 'REASON', adminId: userId },
            },
          },
        });

        if (submission.user.Board) {
          const inProgressColumn = await getColumnId({
            userId: submission.userId,
            boardId: submission.user.Board.id,
            columnName: 'In Progress',
          });

          if (taskInReview) {
            await updateTask({
              taskId: taskInReview.id,
              toColumnId: inProgressColumn as any,
              userId: submission.userId,
            });
          }
        }

        // Send notification
        await saveNotification({
          userId: submission.userId,
          message: `❌ Changes requested for your final draft in campaign ${submission.campaign.name}. Feedback is provided.`,
          entity: Entity.Draft,
          entityId: submission.campaignId,
        });
      }
    });

    console.log('=== adminManageFinalDraft END ===');
    return res.status(200).json({ message: 'Successfully submitted' });
  } catch (error) {
    console.error('Error in adminManageFinalDraft:', error);
    return res.status(400).json({ error: error.message });
  }
};

export const getDeliverables = async (req: Request, res: Response) => {
  const { userId, campaignId } = req.params;
  if (!userId || !campaignId) return res.status(404).json({ message: 'userId and campaignId are required' });
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ message: 'User not found' });
    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) return res.status(404).json({ message: 'Campaign not found' });

    const videos = await prisma.video.findMany({
      where: {
        userId: user.id,
        campaignId: campaign.id,
      },
    });

    const rawFootages = await prisma.rawFootage.findMany({
      where: {
        userId: user.id,
        campaignId: campaign.id,
      },
    });

    const photos = await prisma.photo.findMany({
      where: {
        userId: user.id,
        campaignId: campaign.id,
      },
    });

    return res.status(200).json({ videos, rawFootages, photos });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const adminManageRawFootages = async (req: Request, res: Response) => {
  const { rawFootages, submissionId, rawFootageContent, type, sectionOnly } = req.body;

  if (!rawFootages.length) return res.status(404).json({ message: 'At least one video is required' });

  try {
    const submission = await prisma.submission.findUnique({
      where: {
        id: submissionId,
      },
      select: {
        id: true,
        submissionType: true,
        userId: true,
        status: true,
        campaignId: true,
        feedback: true,
      },
    });

    if (!submission) return res.status(404).json({ message: 'Submission not found' });

    // Update raw footage status based on action type
    await prisma.rawFootage.updateMany({
      where: {
        campaignId: submission.campaignId,
        userId: submission.userId,
        id: { in: rawFootages },
      },
      data: {
        status: type === 'approve' ? 'APPROVED' : 'REVISION_REQUESTED',
      },
    });

    // If sectionOnly flag is present, don't change submission status for either approve or request
    if (sectionOnly) {
      // Just update the footage status, don't change submission status
      // Add feedback regardless of type
      if (submission.status === 'CHANGES_REQUIRED' && submission.feedback.length && type === 'request') {
        // Update existing feedback if already in CHANGES_REQUIRED state
        const feedbackId = submission.feedback[0].id;

        await prisma.feedback.update({
          where: {
            id: feedbackId,
          },
          data: {
            rawFootageContent: rawFootageContent,
            submissionId: submission.id,
            adminId: req.session.userid,
            rawFootageToUpdate: {
              push: rawFootages,
            },
          },
        });
      } else {
        // Add new feedback without changing submission status
        await prisma.feedback.create({
          data: {
            rawFootageContent: rawFootageContent,
            adminId: req.session.userid,
            submissionId: submission.id,
            type: type === 'approve' ? 'COMMENT' : 'REQUEST',
            ...(type === 'request' && { rawFootageToUpdate: rawFootages }),
          },
        });
      }
    }
    // Handle approve without sectionOnly flag
    else if (type === 'approve') {
      // Update submission status to APPROVED if needed
      await prisma.submission.update({
        where: {
          id: submission.id,
        },
        data: {
          status: 'APPROVED',
          feedback: rawFootageContent
            ? {
                create: {
                  rawFootageContent: rawFootageContent,
                  adminId: req.session.userid,
                  type: 'COMMENT',
                },
              }
            : undefined,
        },
      });

      // Update kanban board for full approvals
      await handleKanbanSubmission(submission.id);
    }
    // Handle request changes flow without sectionOnly
    else if (type === 'request') {
      if (submission.status === 'CHANGES_REQUIRED' && submission.feedback.length) {
        // get existing feedbacks
        const feedbackId = submission.feedback[0].id;

        await prisma.feedback.update({
          where: {
            id: feedbackId,
          },
          data: {
            rawFootageContent: rawFootageContent,
            submissionId: submission.id,
            adminId: req.session.userid,
            rawFootageToUpdate: {
              push: rawFootages,
            },
          },
        });
      } else {
        await prisma.submission.update({
          where: {
            id: submission.id,
          },
          data: {
            status: 'CHANGES_REQUIRED',
            feedback: {
              create: {
                rawFootageContent: rawFootageContent,
                adminId: req.session.userid,
                rawFootageToUpdate: rawFootages,
                type: 'REQUEST',
              },
            },
          },
        });
      }

      // Update kanban board for full change requests
      await handleKanbanSubmission(submission.id);
    }

    // Send notifications regardless of sectionOnly flag
    const notification = await handleSubmissionNotification(submission.id);
    io.to(clients.get(submission.userId)).emit('notification', notification);
    io.to(clients.get(submission.userId)).emit('newFeedback');

    return res.status(200).json({
      message: type === 'approve' ? 'Raw footage approved successfully' : 'Changes requested successfully',
    });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const updateSubmissionStatus = async (req: Request, res: Response) => {
  const { submissionId, status, feedback, dueDate } = req.body;

  if (!submissionId || !status) {
    return res.status(400).json({ message: 'submissionId and status are required' });
  }

  try {
    console.log(`Updating submission ${submissionId} to status: ${status}`);

    // First get the submission with necessary relations to handle transitions
    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        user: {
          include: {
            Board: {
              include: {
                columns: {
                  include: {
                    task: true,
                  },
                },
              },
            },
          },
        },
        campaign: {
          include: {
            campaignRequirement: true,
          },
        },
        submissionType: true,
        video: true, // Use "video" instead of "videos" to match Prisma schema
        photos: true,
        rawFootages: true,
      },
    });

    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    console.log(`Current submission status: ${submission.status}, Updating to: ${status}`);

    // Auto-detect if this is a status sync request without explicit status change
    if (status === 'AUTO_SYNC') {
      console.log('Auto-sync request detected, checking deliverable statuses to determine appropriate status...');

      // Determine which deliverable types are required for this campaign
      const requiresVideos = submission.video.length > 0;
      const requiresPhotos = submission.photos.length > 0;
      const requiresRawFootages = submission.rawFootages.length > 0;

      // Check if any required deliverables have a REVISION_REQUESTED status
      const videoNeedsChanges = requiresVideos && submission.video.some((v) => v.status === 'REVISION_REQUESTED');
      const photosNeedChanges = requiresPhotos && submission.photos.some((p) => p.status === 'REVISION_REQUESTED');
      const rawFootageNeedsChanges =
        requiresRawFootages && submission.rawFootages.some((f) => f.status === 'REVISION_REQUESTED');

      // Check if all required deliverables have been decided (either APPROVED or REVISION_REQUESTED)
      const videosDecided =
        !requiresVideos || submission.video.every((v) => v.status === 'APPROVED' || v.status === 'REVISION_REQUESTED');
      const photosDecided =
        !requiresPhotos || submission.photos.every((p) => p.status === 'APPROVED' || p.status === 'REVISION_REQUESTED');
      const rawFootagesDecided =
        !requiresRawFootages ||
        submission.rawFootages.every((f) => f.status === 'APPROVED' || f.status === 'REVISION_REQUESTED');

      // Only proceed if all applicable deliverables have been decided
      const allDecided = videosDecided && photosDecided && rawFootagesDecided;

      if (!allDecided) {
        console.log('Not all deliverables have decisions yet, keeping status as is');
        return res.status(200).json({
          message: `Submission status unchanged; not all deliverables have been reviewed`,
          submission,
        });
      }

      // Determine appropriate status based on deliverable statuses
      const anyNeedsChanges = videoNeedsChanges || photosNeedChanges || rawFootageNeedsChanges;

      if (anyNeedsChanges) {
        // Set status to CHANGES_REQUIRED if any deliverable needs changes
        console.log('Some deliverables need changes, updating status to CHANGES_REQUIRED');
        return await updateSubmissionWithStatus(
          submissionId,
          'CHANGES_REQUIRED',
          feedback || null,
          dueDate,
          req.session.userid,
          res,
          req,
        );
      } else {
        // All deliverables are approved, so set status to APPROVED
        console.log('All deliverables are approved, updating status to APPROVED');
        return await updateSubmissionWithStatus(
          submissionId,
          'APPROVED',
          feedback || null,
          dueDate,
          req.session.userid,
          res,
          req,
        );
      }
    }

    // Check if status is already the requested status
    if (submission.status === status) {
      console.log(`Submission is already in ${status} status. Checking if update is still needed...`);

      // If status is already what's requested, check if we still need to update due date or add feedback
      const updates: Record<string, any> = {};

      if (dueDate) {
        updates.dueDate = new Date(dueDate);
        console.log(`Updating due date to: ${dueDate}`);
      }

      if (feedback) {
        updates.feedback = {
          create: {
            content: feedback,
            adminId: req.session.userid,
            type: 'COMMENT',
          },
        };
        console.log(`Adding feedback: ${feedback}`);
      }

      // If we have updates to make, apply them
      if (Object.keys(updates).length > 0) {
        const updatedSubmission = await prisma.submission.update({
          where: { id: submissionId },
          data: updates,
        });
        console.log(`Added feedback/due date to submission that was already in ${status} status`);
        return res.status(200).json({
          message: `Submission already in ${status} status, updated other fields`,
          submission: updatedSubmission,
        });
      }

      // If no updates needed
      return res.status(200).json({
        message: `Submission already in ${status} status, no changes made`,
        submission,
      });
    }

    return await updateSubmissionWithStatus(submissionId, status, feedback, dueDate, req.session.userid, res, req);
  } catch (error) {
    console.error('Error updating submission status:', error);
    return res.status(500).json({
      message: 'Failed to update submission status',
      error: error.message,
    });
  }
};

// Helper function to update submission with a given status
const updateSubmissionWithStatus = async (
  submissionId: string,
  status: string,
  feedback: string | null | undefined,
  dueDate: string | null | undefined,
  userId: string,
  res: Response,
  req: Request,
) => {
  try {
    // Convert string status to proper SubmissionStatus enum value
    // by using a type assertion - we assume the status is valid
    const submissionStatus = status as any; // This will be enforced by Prisma schema

    // Update the submission status
    const updatedSubmission = await prisma.submission.update({
      where: {
        id: submissionId,
      },
      data: {
        status: submissionStatus,
        ...(dueDate && { dueDate: new Date(dueDate) }),
        ...(status === 'APPROVED' && {
          completedAt: new Date(),
          approvedByAdminId: userId,
        }),
        ...(status === 'CHANGES_REQUIRED' && {
          completedAt: new Date(),
        }),
        feedback: feedback
          ? {
              create: {
                content: feedback,
                adminId: userId,
                type: 'COMMENT',
              },
            }
          : undefined,
      },
      include: {
        user: {
          include: {
            Board: {
              include: {
                columns: {
                  include: {
                    task: true,
                  },
                },
              },
            },
          },
        },
        campaign: true,
        submissionType: true,
        task: true,
      },
    });

    // If this is a first draft being approved, handle the transition to posting or final draft
    if (
      status === 'APPROVED' &&
      (updatedSubmission.submissionType?.type === 'FINAL_DRAFT' ||
        updatedSubmission.submissionType?.type === 'FIRST_DRAFT')
    ) {
      // Find the next submission (posting or final draft)
      const nextSubmissionType =
        updatedSubmission.submissionType?.type === 'FIRST_DRAFT'
          ? updatedSubmission.campaign?.campaignType === 'normal'
            ? 'POSTING'
            : 'FINAL_DRAFT'
          : 'POSTING';

      const nextSubmission = await prisma.submission.findFirst({
        where: {
          userId: updatedSubmission.userId,
          campaignId: updatedSubmission.campaignId,
          submissionType: {
            type: nextSubmissionType,
          },
        },
        include: {
          task: true,
          submissionType: true,
        },
      });

      if (nextSubmission) {
        // If it's a posting submission, set the schedule dates
        if (nextSubmission.submissionType.type === 'POSTING') {
          const postingDueDate = dueDate || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // Default to 7 days from now if no due date
          await prisma.submission.update({
            where: { id: nextSubmission.id },
            data: {
              startDate: new Date(postingDueDate),
              endDate: new Date(postingDueDate),
              dueDate: new Date(postingDueDate),
              status: 'IN_PROGRESS',
            },
          });
          console.log(`Set posting dates to: ${postingDueDate}`);

          // When posting is set to IN_PROGRESS, ensure final draft is APPROVED
          if (updatedSubmission.submissionType.type === 'FINAL_DRAFT') {
            await prisma.submission.update({
              where: { id: updatedSubmission.id },
              data: {
                status: 'APPROVED',
                isReview: true,
                completedAt: new Date(),
                approvedByAdminId: req.session.userid as string,
              },
            });
            console.log(`Updated final draft status to APPROVED`);
          }
        } else if (nextSubmission.submissionType.type === 'FINAL_DRAFT') {
          // If it's a final draft, update its status to APPROVED
          await prisma.submission.update({
            where: { id: nextSubmission.id },
            data: {
              status: 'APPROVED',
              isReview: true,
              completedAt: new Date(),
              approvedByAdminId: req.session.userid as string,
            },
          });
          console.log(`Updated final draft status to APPROVED`);
        }
      }
    }

    // Handle kanban board updates for the current submission
    await handleKanbanSubmission(submissionId);

    // Generate notification for the user
    const notification = await handleSubmissionNotification(submissionId);
    if (notification) {
      // Send notification to user
      io.to(clients.get(updatedSubmission.userId)).emit('notification', notification);
      io.to(clients.get(updatedSubmission.userId)).emit('newFeedback');
      console.log(`Sent notification to user: ${updatedSubmission.userId}`);
    }

    console.log(`Successfully updated submission ${submissionId} to status: ${status}`);
    return res.status(200).json({
      message: `Submission status updated to ${status}`,
      submission: updatedSubmission,
    });
  } catch (error) {
    console.error('Error in updateSubmissionWithStatus:', error);
    return res.status(500).json({
      message: 'Failed to update submission status',
      error: error.message,
    });
  }
};

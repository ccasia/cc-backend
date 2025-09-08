import { Request, Response } from 'express';
import { Entity, FeedbackStatus, Photo, PrismaClient, SubmissionStatus } from '@prisma/client';
import { uploadAgreementForm, uploadPitchVideo } from '@configs/cloudStorage.config';
import { saveNotification } from './notificationController';
import { activeProcesses, clients, io } from '../server';
import Ffmpeg from 'fluent-ffmpeg';
import FfmpegPath from '@ffmpeg-installer/ffmpeg';
import amqplib from 'amqplib';
import dayjs from 'dayjs';
import { MAP_TIMELINE } from '@constants/map-timeline';
import { logAdminChange, logChange } from '@services/campaignServices';
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
  handleCompletedCampaign,
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

      // Log creator activity
      if (submission.campaignId) {
        const logMessage = `${submission.user.name} submitted the Agreement`;
        await logChange(logMessage, submission.campaignId, req);
      }

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
      // Get user info first
      const user = await prisma.user.findUnique({
        where: {
          id: userId,
        },
        select: {
          email: true,
          name: true,
        },
      });

      const agreementSubs = await prisma.submission.update({
        where: {
          id: submissionId,
        },
        data: {
          status: 'APPROVED',
          isReview: true,
          completedAt: new Date(),
          approvedByAdminId: adminId as string,
        },
        include: {
          task: true,
          campaign: {
            include: {
              campaignBrief: true,
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

      // If this is a V4 campaign, create content submissions after agreement approval
      if (agreementSubs.campaign.submissionVersion === 'v4') {
        console.log(`🔄 V4 campaign detected - attempting to create content submissions for agreement ${agreementSubs.id}`);
        try {
          const { createContentSubmissionsAfterAgreement } = require('../service/submissionV4Service');
          const contentSubmissions = await createContentSubmissionsAfterAgreement(agreementSubs);
          console.log(`✅ Created ${contentSubmissions.count} V4 content submissions after agreement approval`);
        } catch (error) {
          console.error('❌ Error creating V4 content submissions after agreement approval:', error);
          // Don't fail the whole request, just log the error
        }
      } else {
        console.log(`ℹ️  Campaign ${agreementSubs.campaignId} is not V4 (version: ${agreementSubs.campaign.submissionVersion}) - skipping V4 content submission creation`);
      }

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

      // Get admin info for logging admin activity
      const admin = await prisma.user.findUnique({
        where: { id: adminId },
      });
      const adminName = admin?.name || 'Admin';
      const creatorName = user?.name || 'Creator';

      // Log admin activity for agreement approval
      const adminActivityMessage = `${adminName} approved the Agreement by ${creatorName}`;
      await logChange(adminActivityMessage, campaign.id, req);

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

      // Get user info for logging
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { name: true },
      });

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

      // Log admin activity for rejection
      if (campaignId && adminId && user) {
        const admin = await prisma.user.findUnique({ where: { id: adminId } });
        const adminName = admin?.name || 'Admin';
        const adminActivityMessage = `${adminName} requested changes on ${user.name}'s Agreement submission`;
        await logChange(adminActivityMessage, campaignId, req);
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
            id: true,
            name: true,
            email: true,
            photoURL: true,
          },
        },
        campaign: {
          select: {
            name: true,
          },
        },
        admin: {
          select: {
            user: {
              select: {
                id: true,
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
      content: submission.content || null,
      user: submission.user,
      userId: submission.user.id,
      campaign: submission.campaign,
      campaignId: submission.campaignId,
      feedback: submission.feedback,
      approvedByAdmin: submission.admin?.user,
    }));

    return res.status(200).json({ submissions: formattedSubmissions });
  } catch (error) {
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
            // Error moving file - skip this file
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

    // Log creator activity
    if (submission.campaignId) {
      const submissionTypeName = submission.submissionType.type === 'FIRST_DRAFT' ? 'First Draft' : 'Final Draft';
      const logMessage = `${submission.user.name} submitted ${submissionTypeName}`;
      await logChange(logMessage, submission.campaignId, req);
    }

    activeProcesses.set(submissionId, { status: 'queue' });

    // await channel.close();
    // await amqp.close();

    return res.status(200).json({ message: 'Video start processing' });
  } catch (error) {
    return res.status(400).json(error);
  } finally {
    if (channel) await channel.close();
    if (amqp) await amqp.close();
  }
};

export const adminManageDraft = async (req: Request, res: Response) => {
  const { submissionId, feedback, type, reasons, userId, sectionOnly, dueDate, section } = req.body;

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
        video: true,
        rawFootages: true,
        photos: true,
      },
    });

    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    if (type === 'approve') {
      // Start a transaction to ensure all updates are atomic
      const result = await prisma.$transaction(async (tx) => {
        // Check if all sections are approved when doing a section approval
        const allSectionsApproved = await checkAllSectionsApproved(submission, section);

        const approveSubmission = await tx.submission.update({
          where: {
            id: submission?.id,
          },
          data: {
            // Only update main status if all sections are approved or it's not a section-only approval
            status: sectionOnly && !allSectionsApproved ? submission.status : 'APPROVED',
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
        if (submission.submissionType.type === 'FIRST_DRAFT' && allSectionsApproved) {
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
            await tx.submission.update({
              where: { id: finalDraft.id },
              data: {
                status: 'NOT_STARTED',
                nextsubmissionDate: new Date(),
              },
            });
          }
        }

        // If all sections are approved and dueDate is provided, update the posting submission
        if (allSectionsApproved && dueDate) {
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
                status: 'IN_PROGRESS',
                dueDate: new Date(dueDate),
                startDate: new Date(dueDate),
                endDate: new Date(dueDate),
              },
            });
          }
        }

        // Move task from column In Review to Done if all sections are approved
        if (allSectionsApproved) {
          const doneColumnId = await getColumnId({ userId: submission.userId, columnName: 'Done' });

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
        }

        return approveSubmission;
      });

      // Send notifications and handle post-approval actions
      const image: any = submission?.campaign?.campaignBrief?.images || [];

      if (submission.submissionType.type === 'FIRST_DRAFT' && result.status === 'APPROVED') {
        approvalOfDraft(
          submission.user.email,
          submission.campaign.name,
          submission.user.name ?? 'Creator',
          submission.campaignId,
          image[0],
        );
      } else if (submission.submissionType.type === 'FINAL_DRAFT' && result.status === 'APPROVED') {
        approvalOfDraft(
          submission.user.email,
          submission.campaign.name,
          submission.user.name ?? 'Creator',
          submission.campaignId,
          image[0],
        );
      } else if (!sectionOnly) {
        feedbackOnDraft(
          submission.user.email,
          submission.campaign.name,
          submission.user.name ?? 'Creator',
          submission.campaignId,
        );
      }

      // Handle UGC campaign specific logic
      if (submission.campaign.campaignType === 'ugc' && result.status === 'APPROVED') {
        const invoiceAmount = submission.user.creatorAgreement.find(
          (elem: any) => elem.campaignId === submission.campaign.id,
        )?.amount;

        const invoice = await createInvoiceService(submission, userId, invoiceAmount, undefined, undefined, userId);

        const shortlistedCreator = await prisma.shortListedCreator.findFirst({
          where: {
            AND: [{ userId: submission.userId }, { campaignId: submission.campaignId }],
          },
        });

        if (shortlistedCreator) {
          await prisma.shortListedCreator.update({
            where: {
              id: shortlistedCreator.id,
            },
            data: {
              isCampaignDone: true,
            },
          });
        }
      }

      // Send notification for section approval
      const { title, message } = notificationApproveDraft(
        submission.campaign.name,
        sectionOnly
          ? `${section} in ${MAP_TIMELINE[submission.submissionType.type]}`
          : MAP_TIMELINE[submission.submissionType.type],
      );

      // Log admin activity for draft approval
      if (submission.campaignId && userId) {
        const admin = await prisma.user.findUnique({ where: { id: userId } });
        const adminName = admin?.name || 'Admin';
        const submissionTypeName = submission.submissionType.type === 'FIRST_DRAFT' ? 'First Draft' : 'Final Draft';
        const sectionText = sectionOnly ? ` (${section} section)` : '';
        const adminActivityMessage = `${adminName} approved ${submission.user.name}'s ${submissionTypeName}${sectionText}`;
        await logChange(adminActivityMessage, submission.campaignId, req);
      }

      const notification = await saveNotification({
        userId: submission.userId,
        title: title,
        message: message,
        entity: 'Draft',
        creatorId: submission.userId,
        entityId: submission.campaignId,
      });

      io.to(clients.get(submission.userId)).emit('notification', notification);
      io.to(clients.get(submission.userId)).emit('newFeedback');

      return res.status(200).json({ message: 'Draft approved successfully', submission: result });
    } else {
      // Handle changes required flow
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

      // Handle task movement for changes required
      const inProgressColumnId = await getColumnId({ userId: sub.userId, columnName: 'In Progress' });
      const inReviewId = await getColumnId({ userId: sub.userId, columnName: 'In Review' });

      const inReviewColumn = await prisma.columns.findUnique({
        where: {
          id: inReviewId!,
        },
        include: {
          task: true,
        },
      });

      const taskInReview = inReviewColumn?.task.find((item) => item.submissionId === sub.id);

      if (taskInReview && inProgressColumnId) {
        await prisma.task.update({
          where: {
            id: taskInReview.id,
          },
          data: {
            columnId: inProgressColumnId,
          },
        });
      }

      // Send notification for changes required
      const { title, message } = notificationRejectDraft(
        submission.campaign.name,
        MAP_TIMELINE[sub.submissionType.type],
      );

      // Log admin activity for requesting changes
      if (sub.campaignId && req.session.userid) {
        const admin = await prisma.user.findUnique({ where: { id: req.session.userid } });
        const adminName = admin?.name || 'Admin';
        const submissionTypeName = sub.submissionType.type === 'FIRST_DRAFT' ? 'First Draft' : 'Final Draft';
        const adminActivityMessage = `${adminName} requested changes on ${sub.user.name}'s ${submissionTypeName}`;
        await logChange(adminActivityMessage, sub.campaignId, req);
      }

      const notification = await saveNotification({
        userId: sub.userId,
        message: message,
        title: title,
        entity: 'Draft',
        entityId: submission.campaignId,
      });

      io.to(clients.get(sub.userId)).emit('notification', notification);
      io.to(clients.get(sub.userId)).emit('newFeedback');

      return res.status(200).json({ message: 'Changes requested successfully' });
    }
  } catch (error) {
    return res.status(400).json(error);
  }
};

// Helper function to check if all required sections are approved
const checkAllSectionsApproved = async (submission: any, currentSection?: string) => {
  if (!submission) return false;

  const hasVideos = submission.video && submission.video.length > 0;
  const hasRawFootages = submission.rawFootages && submission.rawFootages.length > 0;
  const hasPhotos = submission.photos && submission.photos.length > 0;

  // If a section is being approved, consider it as approved for this check
  const videosApproved = hasVideos
    ? currentSection === 'videos' || submission.video.every((v: { status: string }) => v.status === 'APPROVED')
    : true;
  const rawFootagesApproved = hasRawFootages
    ? currentSection === 'rawFootages' ||
      submission.rawFootages.every((f: { status: string }) => f.status === 'APPROVED')
    : true;
  const photosApproved = hasPhotos
    ? currentSection === 'photos' || submission.photos.every((p: { status: string }) => p.status === 'APPROVED')
    : true;

  // Only check sections that exist in the submission
  const requiredSections = [
    hasVideos && videosApproved,
    hasRawFootages && rawFootagesApproved,
    hasPhotos && photosApproved,
  ].filter(Boolean);

  return requiredSections.every((approved) => approved === true);
};

export const postingSubmission = async (req: Request, res: Response) => {
  const { submissionId, postingLinks } = req.body;

  try {
    const submission = await prisma.submission.update({
      where: {
        id: submissionId,
      },
      data: {
        videos: postingLinks.filter((link: string) => link && link.trim() !== ''),
        content: postingLinks.filter((link: string) => link && link.trim() !== '').join(', '),
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

    // Log creator activity
    if (submission.campaignId) {
      const logMessage = `${submission.user.name} submitted Posting Link`;
      await logChange(logMessage, submission.campaignId, req);
    }

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

        await createInvoiceService(approvedSubmission, userId, invoiceAmount, invoiceItems, tx as PrismaClient, userId);

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

        // Log admin activity for posting approval
        if (submission.campaignId && userId) {
          const admin = await prisma.user.findUnique({ where: { id: userId } });
          const adminName = admin?.name || 'Admin';
          const adminActivityMessage = `${adminName} approved ${submission.user.name}'s Posting Link`;
          await logChange(adminActivityMessage, submission.campaignId, req);
        }
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

        // Log admin activity for posting rejection
        if (submission.campaignId && userId) {
          const admin = await prisma.user.findUnique({ where: { id: userId } });
          const adminName = admin?.name || 'Admin';
          const adminActivityMessage = `${adminName} requested changes on ${submission.user.name}'s Posting Link`;
          await logChange(adminActivityMessage, submission.campaignId, req);
        }

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
    console.log(error);
    if (error instanceof Error) {
      return res.status(400).json({ error: error.message });
    }
    return res.status(400).json({ error: 'Error approving posting submission' });
  }
};

// V2: CSM submits posting link for superadmin review
export const submitPostingLinkByCSMV2 = async (req: Request, res: Response) => {
  const { submissionId, link } = req.body;
  const adminId = req.session.userid;
  try {
    const submission = await prisma.submission.findUnique({ where: { id: submissionId }, include: { campaign: true } });
    if (!submission) return res.status(404).json({ message: 'Submission not found' });
    // Save link and set to SENT_TO_ADMIN for superadmin review
    await prisma.submission.update({ where: { id: submissionId }, data: { content: link, status: 'SENT_TO_ADMIN', approvedByAdminId: adminId, updatedAt: new Date() } });
    try {
      const io: any = (req as any).app?.get?.('io');
      if (io) io.to(submission.campaignId).emit('v2:campaign:updated', { campaignId: submission.campaignId });
    } catch {}
    return res.status(200).json({ message: 'Posting link submitted for superadmin review' });
  } catch (error) {
    return res.status(400).json(error);
  }
};

// V2: Superadmin approves posting link (generate invoice)
export const approvePostingLinkBySuperadminV2 = async (req: Request, res: Response) => {
  const { submissionId } = req.body;
  const superadminId = req.session.userid;
  try {
    const submission = await prisma.submission.findUnique({ where: { id: submissionId }, include: { campaign: true, user: true } });
    if (!submission) return res.status(404).json({ message: 'Submission not found' });
    await prisma.submission.update({ where: { id: submissionId }, data: { status: 'APPROVED', completedAt: new Date(), approvedByAdminId: superadminId } });
    // Generate invoice using existing service, if applicable in V2
    try {
      const creator = await prisma.shortListedCreator.findFirst({ where: { campaignId: submission.campaignId, userId: submission.userId }, include: { user: { include: { creatorAgreement: true } }, campaign: { include: { campaignBrief: true } } } });
      if (creator && !creator.isCampaignDone) {
        const amount = creator.user?.creatorAgreement.find((e) => e.campaignId === creator.campaign.id)?.amount;
        const invoice = await createInvoiceService({ ...creator, userId: creator.user?.id, campaignId: creator.campaign.id }, superadminId, amount, undefined, undefined, superadminId);
        await prisma.shortListedCreator.update({ where: { userId_campaignId: { userId: creator.user?.id as string, campaignId: creator.campaign.id as string } }, data: { isCampaignDone: true } });
        const images: any = creator.campaign.campaignBrief?.images;
        creatorInvoice(creator?.user?.email as any, creator.campaign.name, creator?.user?.name ?? 'Creator', images?.[0]);
        const { title, message } = notificationInvoiceGenerate(creator.campaign.name);
        await saveNotification({ userId: creator.user?.id as any, title, message, invoiceId: invoice?.id, entity: 'Invoice', entityId: creator.campaign.id });
      }
    } catch {}
    try {
      const io: any = (req as any).app?.get?.('io');
      if (io) io.to(submission.campaignId).emit('v2:campaign:updated', { campaignId: submission.campaignId });
    } catch {}
    return res.status(200).json({ message: 'Posting link approved and invoice generated' });
  } catch (error) {
    return res.status(400).json(error);
  }
};

// V2: Superadmin rejects posting link
export const rejectPostingLinkBySuperadminV2 = async (req: Request, res: Response) => {
  const { submissionId, feedback } = req.body;
  const superadminId = req.session.userid;
  try {
    const submission = await prisma.submission.findUnique({ where: { id: submissionId }, include: { campaign: true } });
    if (!submission) return res.status(404).json({ message: 'Submission not found' });
    await prisma.submission.update({ where: { id: submissionId }, data: { status: 'CHANGES_REQUIRED', approvedByAdminId: superadminId } });
    if (feedback) await prisma.feedback.create({ data: { content: feedback, type: 'REASON', adminId: superadminId, submissionId } });
    try {
      const io: any = (req as any).app?.get?.('io');
      if (io) io.to(submission.campaignId).emit('v2:campaign:updated', { campaignId: submission.campaignId });
    } catch {}
    return res.status(200).json({ message: 'Posting link rejected' });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const adminManagePhotos = async (req: Request, res: Response) => {
  const { photos, submissionId, feedback: photoFeedback, type, sectionOnly } = req.body;

  if (!photos.length) return res.status(404).json({ message: 'At least one photo is required' });
  if (!type) return res.status(400).json({ message: 'Type is required' });

  try {
    const submission = await prisma.submission.findUnique({
      where: {
        id: submissionId,
      },
      select: {
        id: true,
        // videos: true,
        submissionType: true,
        userId: true,
        status: true,
        feedback: {
          orderBy: {
            createdAt: 'desc',
          },
        },
        campaignId: true,
        campaign: true,
        rawFootages: true,
        photos: true,
        video: true,
      },
    });

    if (!submission) return res.status(404).json({ message: 'Submission not found' });

    // Update photo status based on action type
    const updatedPhotos = await prisma.$transaction([
      prisma.photo.updateMany({
        where: {
          campaignId: submission.campaignId,
          userId: submission.userId,
          id: { in: photos },
        },
        data: {
          status: type === 'approve' ? 'APPROVED' : 'REVISION_REQUESTED',
        },
      }),
      prisma.photo.findMany({
        where: {
          campaignId: submission.campaignId,
          userId: submission.userId,
          id: { in: photos },
        },
      }),
    ]);

    const [updateResult, updatedRecords] = updatedPhotos;

    // Check for submission types
    const isRawFootage = submission.campaign.rawFootage;

    const isRawFootageAllApproved =
      !isRawFootage ||
      (submission.rawFootages?.length > 0 && submission.rawFootages.every((item) => item.status === 'APPROVED'));
    const isDraftVideosAllApproved = submission.video.every((item) => item.status === 'APPROVED');
    const isPhotosAllApproved = updatedRecords.every((item) => item.status === 'APPROVED');

    if (type === 'approve' && isDraftVideosAllApproved && isPhotosAllApproved && isRawFootageAllApproved) {
      const updatedSubmission = await prisma.submission.update({
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

      await handleCompletedCampaign(updatedSubmission.id, req.session.userid);
    } else {
      await prisma.submission.update({
        where: {
          id: submission.id,
        },
        data: {
          completedAt: new Date(),
          approvedByAdminId: req.session.userid as string,
          ...(submission.status !== 'CHANGES_REQUIRED' && {
            status: 'CHANGES_REQUIRED',
          }),
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

    await handleKanbanSubmission(submission.id);

    // If sectionOnly flag is present, don't change submission status for either approve or request
    // if (sectionOnly) {
    //   // Just update the photo status, don't change submission status
    //   if (submission.status === 'CHANGES_REQUIRED' && submission.feedback.length && type === 'request') {
    //     // Update existing feedback if already in CHANGES_REQUIRED state
    //     const feedbackId = submission.feedback[0].id;

    //     await prisma.feedback.update({
    //       where: {
    //         id: feedbackId,
    //       },
    //       data: {
    //         photoContent: photoFeedback,
    //         submissionId: submission.id,
    //         adminId: req.session.userid,
    //         photosToUpdate: {
    //           push: photos,
    //         },
    //       },
    //     });
    //   } else {
    //     // Add new feedback without changing submission status
    //     await prisma.feedback.create({
    //       data: {
    //         photoContent: photoFeedback,
    //         adminId: req.session.userid,
    //         submissionId: submission.id,
    //         type: type === 'approve' ? 'COMMENT' : 'REQUEST',
    //         ...(type === 'request' && { photosToUpdate: photos }),
    //       },
    //     });
    //   }
    // }
    // // Handle approve without sectionOnly flag
    // else if (type === 'approve') {
    //   // Update submission status to APPROVED
    //   await prisma.submission.update({
    //     where: {
    //       id: submission.id,
    //     },
    //     data: {
    //       status: 'APPROVED',
    //       completedAt: new Date(),
    //       approvedByAdminId: req.session.userid as string,
    //       feedback: photoFeedback ? {
    //         create: {
    //           photoContent: photoFeedback,
    //           adminId: req.session.userid,
    //           type: 'COMMENT',
    //         },
    //       } : undefined,
    //     },
    //   });

    //   // Update kanban board for full approvals
    //   await handleKanbanSubmission(submission.id);
    // }
    // // Handle request changes flow without sectionOnly
    // else if (type === 'request') {
    //   if (submission.status === 'CHANGES_REQUIRED' && submission.feedback.length) {
    //     // get existing feedbacks
    //     const feedbackId = submission.feedback[0].id;

    //     await prisma.feedback.update({
    //       where: {
    //         id: feedbackId,
    //       },
    //       data: {
    //         photoContent: photoFeedback,
    //         submissionId: submission.id,
    //         adminId: req.session.userid,
    //         photosToUpdate: {
    //           push: photos,
    //         },
    //       },
    //     });
    //   } else {
    //     await prisma.submission.update({
    //       where: {
    //         id: submission.id,
    //       },
    //       data: {
    //         completedAt: new Date(),
    //         approvedByAdminId: req.session.userid as string,
    //         status: 'CHANGES_REQUIRED',
    //         feedback: {
    //           create: {
    //             photoContent: photoFeedback,
    //             adminId: req.session.userid,
    //             photosToUpdate: photos,
    //             type: 'REQUEST',
    //           },
    //         },
    //       },
    //     });
    //   }

    //   // Update kanban board for full change requests
    //   await handleKanbanSubmission(submission.id);
    // }

    // Send notifications regardless of sectionOnly flag
    const notification = await handleSubmissionNotification(submission.id);
    io.to(clients.get(submission.userId)).emit('notification', notification);
    io.to(clients.get(submission.userId)).emit('newFeedback');

    return res.status(200).json({
      message: type === 'approve' ? 'Photos approved successfully' : 'Changes requested successfully',
    });
  } catch (error) {
    return res.status(400).json({ message: error.message || 'Error updating photos' });
  }
};

export const adminManageVideos = async (req: Request, res: Response) => {
  const { videos, submissionId, feedback, reasons, type, sectionOnly, dueDate } = req.body;

  try {
    // If draft video are all approved
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

        // Log admin activity for section-only video approval
        if (submissionId && req.session.userid) {
          const admin = await prisma.user.findUnique({ where: { id: req.session.userid }, include: { admin: true } });
          const adminName = admin?.name || 'Admin';
          const logMessage = `Admin "${adminName}" approved video section for review`;
          // Note: We don't have campaign ID easily accessible here, so we'll get it from the submission
          const submissionData = await prisma.submission.findUnique({
            where: { id: submissionId },
            select: { campaignId: true, user: { select: { name: true } }, submissionType: { select: { type: true } } },
          });
          if (submissionData?.campaignId) {
            const submissionTypeName =
              submissionData.submissionType.type === 'FIRST_DRAFT' ? 'First Draft' : 'Final Draft';
            const adminActivityMessage = `${adminName} approved ${submissionData.user.name}'s ${submissionTypeName} video section`;
            await logChange(adminActivityMessage, submissionData.campaignId, req);
          }
        }

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

          await createInvoiceService(
            approveSubmission,
            approveSubmission.userId,
            invoiceAmount,
            invoiceItems,
            undefined,
            req.session.userid,
          );

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

        // Log admin activity for video approval
        if (approveSubmission.campaignId && req.session.userid) {
          const admin = await prisma.user.findUnique({ where: { id: req.session.userid } });
          const adminName = admin?.name || 'Admin';

          const submissionTypeName =
            approveSubmission.submissionType.type === 'FIRST_DRAFT' ? 'First Draft' : 'Final Draft';
          const adminActivityMessage = `${adminName} approved ${approveSubmission.user.name}'s ${submissionTypeName} videos`;
          await logChange(adminActivityMessage, approveSubmission.campaignId, req);
        }

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

    // If draft videos are rejected
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

    const inReviewColumn = await getColumnId({ userId: submission?.userId, columnName: 'In Review' });
    const doneColumnId = await getColumnId({ userId: submission?.userId, columnName: 'Done' });
    const taskInReview = submission.task.find((item) => item.columnId === inReviewColumn);

    await prisma.$transaction(async (tx) => {
      if (type === 'approve') {
        // If sectionOnly flag is present, only update the videos
        if (sectionOnly) {
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

          // If all sections are approved, update the final draft status
          if (allSectionsApproved) {
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
              // Calculate 3 days from today for posting due date
              const postingDueDate = dueDate
                ? new Date(dueDate)
                : (() => {
                    const threeDaysFromToday = new Date();
                    threeDaysFromToday.setDate(threeDaysFromToday.getDate() + 3);
                    threeDaysFromToday.setHours(23, 59, 59, 999);
                    return threeDaysFromToday;
                  })();
              await tx.submission.update({
                where: { id: postingSubmission.id },
                data: {
                  status: 'IN_PROGRESS',
                  dueDate: postingDueDate,
                  startDate: postingDueDate,
                  endDate: postingDueDate,
                },
              });
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

          // Update all videos to approved
          const videoDeliverables = await tx.video.findMany({
            where: {
              userId: submission.userId,
              campaignId: submission.campaignId,
            },
          });

          if (videoDeliverables.length > 0) {
            await tx.video.updateMany({
              where: {
                userId: submission.userId,
                campaignId: submission.campaignId,
              },
              data: {
                status: 'APPROVED',
              },
            });
          }

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
            // Calculate 3 days from today for posting due date
            const postingDueDate = dueDate
              ? new Date(dueDate)
              : (() => {
                  const threeDaysFromToday = new Date();
                  threeDaysFromToday.setDate(threeDaysFromToday.getDate() + 3);
                  threeDaysFromToday.setHours(23, 59, 59, 999);
                  return threeDaysFromToday;
                })();
            await tx.submission.update({
              where: { id: postingSubmission.id },
              data: {
                status: 'IN_PROGRESS',
                dueDate: postingDueDate,
                startDate: postingDueDate,
                endDate: postingDueDate,
              },
            });
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
        // Request changes
        await tx.submission.update({
          where: { id: submission.id },
          data: {
            status: 'CHANGES_REQUIRED',
            isReview: false,
          },
        });

        if (feedback) {
          await tx.feedback.create({
            data: {
              content: feedback,
              type: 'REQUEST',
              adminId: userId as string,
              submissionId: submission.id,
            },
          });
        }

        const inProgressColumn = await getColumnId({ userId: submission?.userId, columnName: 'In Progress' });

        if (taskInReview) {
          await updateTask({
            taskId: taskInReview.id,
            toColumnId: inProgressColumn as any,
            userId: submission.userId,
          });
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

    return res.status(200).json({ message: 'Successfully submitted' });
  } catch (error) {
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

    // Get all submissions for this user and campaign to access feedback
    const submissions = await prisma.submission.findMany({
      where: {
        userId: user.id,
        campaignId: campaign.id,
      },
      include: {
        feedback: {
          include: {
            admin: {
              select: {
                id: true,
                name: true,
                photoURL: true,
                admin: {
                  select: {
                    role: {
                      select: {
                        name: true,
                      },
                    },
                  },
                },
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });

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

    // Helper function to get feedback for a specific media item
    const getMediaFeedback = (mediaId: string, mediaType: 'video' | 'photo' | 'rawFootage', mediaStatus: string) => {
      const allFeedback = submissions.flatMap((sub) => sub.feedback);

      // Get feedback specifically for this media item
      const mediaSpecificFeedback = allFeedback
        .filter((feedback) => {
          switch (mediaType) {
            case 'video':
              return feedback.videosToUpdate?.includes(mediaId);
            case 'photo':
              return feedback.photosToUpdate?.includes(mediaId);
            case 'rawFootage':
              return feedback.rawFootageToUpdate?.includes(mediaId);
            default:
              return false;
          }
        })
        .map((feedback) => ({
          id: feedback.id,
          content:
            mediaType === 'video'
              ? feedback.content
              : mediaType === 'photo'
                ? feedback.photoContent
                : feedback.rawFootageContent,
          reasons: feedback.reasons || [],
          createdAt: feedback.createdAt,
          admin: feedback.admin,
          type: feedback.type,
        }));

      // Also include client feedback for this submission when media has CLIENT_FEEDBACK status
      const clientFeedback = allFeedback
        .filter((feedback) => 
          feedback.admin?.admin?.role?.name === 'client' && 
          feedback.type === 'REASON' &&
          mediaStatus === 'CLIENT_FEEDBACK'
        )
        .map((feedback) => ({
          id: feedback.id,
          content: feedback.content,
          reasons: feedback.reasons || [],
          createdAt: feedback.createdAt,
          admin: feedback.admin,
          type: feedback.type,
        }));

      return [...mediaSpecificFeedback, ...clientFeedback];
    };

    // Add feedback to each media item
    const videosWithFeedback = videos.map((video) => ({
      ...video,
      individualFeedback: getMediaFeedback(video.id, 'video', video.status),
    }));

    const photosWithFeedback = photos.map((photo) => ({
      ...photo,
      individualFeedback: getMediaFeedback(photo.id, 'photo', photo.status),
    }));

    const rawFootagesWithFeedback = rawFootages.map((footage) => ({
      ...footage,
      individualFeedback: getMediaFeedback(footage.id, 'rawFootage', footage.status),
    }));

    return res.status(200).json({
      videos: videosWithFeedback,
      rawFootages: rawFootagesWithFeedback,
      photos: photosWithFeedback,
      submissions: submissions, // Include submissions with feedback for frontend access
    });
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
  try {
    const { submissionId, status, feedback, dueDate, sectionApproval, approvedSections, updatePosting, forceUpdate } =
      req.body;

    if (!submissionId || !status) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    // Use a transaction to ensure all updates are atomic
    const result = await prisma.$transaction(async (tx) => {
      // Get the current submission with all related data
      const submission = await tx.submission.findUnique({
        where: { id: submissionId },
        include: {
          submissionType: true,
          campaign: true,
          video: true,
          photos: true,
          rawFootages: true,
          feedback: true,
        },
      });

      if (!submission) {
        throw new Error('Submission not found');
      }

      // Handle section approvals if specified
      if (sectionApproval && approvedSections) {
        // Update video statuses if needed
        if (approvedSections.videos && submission.video && submission.video.length > 0) {
          await tx.video.updateMany({
            where: {
              submissionId: submission.id,
              status: { not: 'APPROVED' },
            },
            data: { status: 'APPROVED' },
          });
        }

        // Update raw footage statuses if needed
        if (approvedSections.rawFootages && submission.rawFootages && submission.rawFootages.length > 0) {
          await tx.rawFootage.updateMany({
            where: {
              submissionId: submission.id,
              status: { not: 'APPROVED' },
            },
            data: { status: 'APPROVED' },
          });
        }

        // Update photo statuses if needed
        if (approvedSections.photos && submission.photos && submission.photos.length > 0) {
          await tx.photo.updateMany({
            where: {
              submissionId: submission.id,
              status: { not: 'APPROVED' },
            },
            data: { status: 'APPROVED' },
          });
        }
      }

      // Update the current submission status
      const updatedSubmission = await tx.submission.update({
        where: { id: submissionId },
        data: {
          status,
          ...(feedback && { feedback: { create: { content: feedback, adminId: req.session.userid } } }),
          ...(dueDate && { dueDate: new Date(dueDate) }),
        },
        include: {
          submissionType: true,
          campaign: true,
        },
      });

      // Handle status transitions based on submission type and only if not a section approval
      // or if explicitly requested to update posting status
      if (
        submission.submissionType.type === 'FIRST_DRAFT' &&
        status === 'APPROVED' &&
        (!sectionApproval || updatePosting)
      ) {
        // Find the next submissions (both Final Draft and Posting)
        const [finalDraftSubmission, postingSubmission] = await Promise.all([
          tx.submission.findFirst({
            where: {
              userId: submission.userId,
              campaignId: submission.campaignId,
              submissionType: {
                type: 'FINAL_DRAFT',
              },
            },
          }),
          tx.submission.findFirst({
            where: {
              userId: submission.userId,
              campaignId: submission.campaignId,
              submissionType: {
                type: 'POSTING',
              },
            },
          }),
        ]);

        // When First Draft is approved, update related submissions
        if (status === 'APPROVED') {
          // Set Posting to IN_PROGRESS if it exists and updatePosting is true
          if (postingSubmission && (updatePosting || forceUpdate)) {
            // Calculate 3 days from today for posting due date
            const postingDueDate = dueDate
              ? new Date(dueDate)
              : (() => {
                  const threeDaysFromToday = new Date();
                  threeDaysFromToday.setDate(threeDaysFromToday.getDate() + 3);
                  threeDaysFromToday.setHours(23, 59, 59, 999);
                  return threeDaysFromToday;
                })();

            await tx.submission.update({
              where: { id: postingSubmission.id },
              data: {
                status: 'IN_PROGRESS',
                dueDate: postingDueDate,
                startDate: postingDueDate,
                endDate: postingDueDate,
              },
            });
          }

          // Set Final Draft to NOT_STARTED if it exists
          if (finalDraftSubmission) {
            await tx.submission.update({
              where: { id: finalDraftSubmission.id },
              data: { status: 'NOT_STARTED' },
            });
          }
        }
        // Handle other status transitions as before
        else if (status === 'CHANGES_REQUIRED') {
          // When First Draft needs changes:
          // 1. Set Final Draft to IN_PROGRESS if it exists
          if (finalDraftSubmission) {
            await tx.submission.update({
              where: { id: finalDraftSubmission.id },
              data: { status: 'IN_PROGRESS' },
            });
          }

          // 2. Set Posting to NOT_STARTED if it exists
          if (postingSubmission) {
            await tx.submission.update({
              where: { id: postingSubmission.id },
              data: { status: 'NOT_STARTED' },
            });
          }
        } else if (status === 'PENDING_REVIEW') {
          // When First Draft is in review, set both to NOT_STARTED
          if (finalDraftSubmission) {
            await tx.submission.update({
              where: { id: finalDraftSubmission.id },
              data: { status: 'NOT_STARTED' },
            });
          }

          if (postingSubmission) {
            await tx.submission.update({
              where: { id: postingSubmission.id },
              data: { status: 'NOT_STARTED' },
            });
          }
        }
      }

      // Handle Final Draft posting activation
      if (
        submission.submissionType.type === 'FINAL_DRAFT' &&
        status === 'APPROVED' &&
        (!sectionApproval || updatePosting)
      ) {
        // Find the posting submission
        const postingSubmission = await tx.submission.findFirst({
          where: {
            userId: submission.userId,
            campaignId: submission.campaignId,
            submissionType: {
              type: 'POSTING',
            },
          },
        });

        // When Final Draft is approved, activate posting
        if (status === 'APPROVED' && postingSubmission && (updatePosting || forceUpdate)) {
          // Calculate 3 days from today for posting due date
          const postingDueDate = dueDate
            ? new Date(dueDate)
            : (() => {
                const threeDaysFromToday = new Date();
                threeDaysFromToday.setDate(threeDaysFromToday.getDate() + 3);
                threeDaysFromToday.setHours(23, 59, 59, 999);
                return threeDaysFromToday;
              })();

          await tx.submission.update({
            where: { id: postingSubmission.id },
            data: {
              status: 'IN_PROGRESS',
              dueDate: postingDueDate,
              startDate: postingDueDate,
              endDate: postingDueDate,
            },
          });
        }
      }

      return {
        updatedSubmission,
        submission,
      };
    });

    // Small delay to ensure all database operations are fully committed
    await new Promise((resolve) => setTimeout(resolve, 100));

    return res.status(200).json({
      message: sectionApproval ? 'Section approval updated successfully' : `Submission status updated to ${status}`,
      submission: result.updatedSubmission,
      sectionApproval: sectionApproval || false,
    });
  } catch (error) {
    console.error('Error updating submission status:', error);
    return res.status(500).json({ message: 'Error updating submission status', error: error.message });
  }
};

export const adminManagePhotosV2 = async (req: Request, res: Response) => {
  const { mediaId, status, feedback, reasons, preventStatusChange } = req.body;

  // Validate required fields
  if (!mediaId || !status) {
    return res.status(400).json({
      message: 'Missing required fields: mediaId and status are required',
    });
  }

  if (!['APPROVED', 'CHANGES_REQUIRED'].includes(status)) {
    return res.status(400).json({
      message: 'Invalid status. Must be "APPROVED" or "CHANGES_REQUIRED"',
    });
  }

  try {
    // Wrap everything in a transaction for data consistency
    const result = await prisma.$transaction(async (tx) => {
      // Find the photo
      const photo = await tx.photo.findUnique({
        where: { id: mediaId },
        include: {
          submission: {
            include: {
              campaign: true,
              user: true,
              photos: true,
              video: true,
              rawFootages: true,
              submissionType: true,
            },
          },
        },
      });

      if (!photo) {
        throw new Error('Photo not found');
      }

      // Update ONLY this specific photo's status
      const newStatus = status === 'APPROVED' ? 'APPROVED' : 'REVISION_REQUESTED';

      await tx.photo.update({
        where: { id: mediaId },
        data: { status: newStatus },
      });

      // Enhanced feedback system - store individual feedback with media ID reference
      if (feedback) {
        // Clean the reasons array to remove any null/undefined values
        const cleanReasons = Array.isArray(reasons)
          ? reasons.filter((reason) => reason !== null && reason !== undefined && reason !== '')
          : reasons
            ? [reasons]
            : [];

        await tx.feedback.create({
          data: {
            photoContent: feedback,
            adminId: req.session.userid as string,
            submissionId: photo.submissionId as string,
            type: status === 'APPROVED' ? 'COMMENT' : 'REQUEST',
            photosToUpdate: [mediaId], // Always include media ID for both approved and changes required
            reasons: cleanReasons,
          },
        });
      }

      // Individual media logging removed - will log at submission level instead

      // Check if we should update submission status based on overall review progress
      if (!photo.submission) {
        throw new Error('Submission not found');
      }

      const campaign = photo.submission.campaign;
      const submission = photo.submission;

      // Get current status of all media in this submission after this update
      const allPhotos = await tx.photo.findMany({
        where: {
          submissionId: photo.submissionId,
          userId: photo.userId,
          campaignId: photo.campaignId,
        },
      });

      const allVideos = await tx.video.findMany({
        where: {
          submissionId: photo.submissionId,
          userId: photo.userId,
          campaignId: photo.campaignId,
        },
      });

      const allRawFootages = await tx.rawFootage.findMany({
        where: {
          submissionId: photo.submissionId,
          userId: photo.userId,
          campaignId: photo.campaignId,
        },
      });

      // Determine which sections are required for this campaign
      const requiresVideos = true;
      const requiresRawFootages = campaign.rawFootage;
      const requiresPhotos = campaign.photos;

      // Check if all required media items have been reviewed (either approved or revision requested)
      const photosAllReviewed =
        !requiresPhotos ||
        allPhotos.length === 0 ||
        allPhotos.every((p) => p.status === 'APPROVED' || p.status === 'REVISION_REQUESTED');
      const videosAllReviewed =
        !requiresVideos ||
        allVideos.length === 0 ||
        allVideos.every((v) => v.status === 'APPROVED' || v.status === 'REVISION_REQUESTED');
      const rawFootagesAllReviewed =
        !requiresRawFootages ||
        allRawFootages.length === 0 ||
        allRawFootages.every((rf) => rf.status === 'APPROVED' || rf.status === 'REVISION_REQUESTED');

      // Only update submission status if all required sections have been fully reviewed
      const allSectionsReviewed = photosAllReviewed && videosAllReviewed && rawFootagesAllReviewed;

      let submissionUpdated = false;
      let postingSubmission = null;

      if (allSectionsReviewed) {
        // Check final approval status
        const photosApproved =
          !requiresPhotos || allPhotos.length === 0 || allPhotos.every((p) => p.status === 'APPROVED');
        const videosApproved =
          !requiresVideos || allVideos.length === 0 || allVideos.every((v) => v.status === 'APPROVED');
        const rawFootagesApproved =
          !requiresRawFootages || allRawFootages.length === 0 || allRawFootages.every((rf) => rf.status === 'APPROVED');

        // Check if any required section has changes requested
        const photosHaveChanges = requiresPhotos && allPhotos.some((p) => p.status === 'REVISION_REQUESTED');
        const videosHaveChanges = requiresVideos && allVideos.some((v) => v.status === 'REVISION_REQUESTED');
        const rawFootagesHaveChanges =
          requiresRawFootages && allRawFootages.some((rf) => rf.status === 'REVISION_REQUESTED');

        if (photosApproved && videosApproved && rawFootagesApproved) {
          // All sections approved - update to APPROVED
          await tx.submission.update({
            where: { id: photo.submissionId as string },
            data: {
              status: 'APPROVED',
              completedAt: new Date(),
              approvedByAdminId: req.session.userid as string,
            },
          });

          submissionUpdated = true;

          // Log consolidated admin activity for submission approval
          if (photo.campaignId && req.session.userid) {
            const admin = await tx.user.findUnique({ where: { id: req.session.userid } });
            const adminName = admin?.name || 'Admin';
            const submissionTypeName =
              photo.submission?.submissionType?.type === 'FIRST_DRAFT' ? 'First Draft' : 'Final Draft';
            const adminActivityMessage = `${adminName} approved ${photo.submission?.user?.name || 'Unknown'}'s ${submissionTypeName}`;
            await logChange(adminActivityMessage, photo.campaignId, req);
          }

          // Check if this campaign has a posting submission
          postingSubmission = await tx.submission.findFirst({
            where: {
              userId: submission.userId,
              campaignId: submission.campaignId,
              submissionType: { type: 'POSTING' },
            },
          });

          // Only do full workflow logic if preventStatusChange is not true
          if (!preventStatusChange) {
            // Handle next steps based on submission type
            if (submission.submissionType.type === 'FIRST_DRAFT') {
              // Activate posting submission
              if (postingSubmission) {
                // Calculate 3 days from today (not from current timestamp)
                const threeDaysFromToday = new Date();
                threeDaysFromToday.setDate(threeDaysFromToday.getDate() + 3);
                threeDaysFromToday.setHours(23, 59, 59, 999); // Set to end of day

                await tx.submission.update({
                  where: { id: postingSubmission.id },
                  data: {
                    status: 'IN_PROGRESS',
                    dueDate: threeDaysFromToday,
                    startDate: threeDaysFromToday,
                    endDate: threeDaysFromToday,
                  },
                });
              }
            } else if (submission.submissionType.type === 'FINAL_DRAFT') {
              // Activate posting submission for final draft
              if (postingSubmission) {
                // Calculate 3 days from today (not from current timestamp)
                const threeDaysFromToday = new Date();
                threeDaysFromToday.setDate(threeDaysFromToday.getDate() + 3);
                threeDaysFromToday.setHours(23, 59, 59, 999); // Set to end of day

                await tx.submission.update({
                  where: { id: postingSubmission.id },
                  data: {
                    status: 'IN_PROGRESS',
                    dueDate: threeDaysFromToday,
                    startDate: threeDaysFromToday,
                    endDate: threeDaysFromToday,
                  },
                });
              }
            }
          }
        } else if (photosHaveChanges || videosHaveChanges || rawFootagesHaveChanges) {
          // Some sections have changes requested - update to CHANGES_REQUIRED
          await tx.submission.update({
            where: { id: photo.submissionId as string },
            data: { status: 'CHANGES_REQUIRED' },
          });

          submissionUpdated = true;

          // Log consolidated admin activity for changes requested
          if (photo.campaignId && req.session.userid) {
            const admin = await tx.user.findUnique({ where: { id: req.session.userid } });
            const adminName = admin?.name || 'Admin';
            const submissionTypeName =
              photo.submission?.submissionType?.type === 'FIRST_DRAFT' ? 'First Draft' : 'Final Draft';
            const adminActivityMessage = `${adminName} requested changes on ${photo.submission?.user?.name || 'Unknown'}'s ${submissionTypeName}`;
            await logChange(adminActivityMessage, photo.campaignId, req);
          }

          // Always activate Final Draft when changes are requested, regardless of preventStatusChange
          // This is essential for the workflow to function properly
          if (submission.submissionType.type === 'FIRST_DRAFT') {
            const finalDraftSubmission = await tx.submission.findFirst({
              where: {
                userId: submission.userId,
                campaignId: submission.campaignId,
                submissionType: { type: 'FINAL_DRAFT' },
              },
            });

            if (finalDraftSubmission) {
              await tx.submission.update({
                where: { id: finalDraftSubmission.id },
                data: { status: 'IN_PROGRESS' },
              });
            }
          }
        }
      }

      return {
        photo,
        submission,
        newStatus,
        submissionUpdated,
        allSectionsReviewed,
        photosAllReviewed: photosAllReviewed,
        videosAllReviewed: videosAllReviewed,
        rawFootagesAllReviewed: rawFootagesAllReviewed,
        postingSubmission,
      };
    });

    // Handle post-transaction operations (outside transaction for performance)
    if (result.submissionUpdated) {
      // Handle completed campaign logic if needed
      if (!preventStatusChange) {
        // Only call handleCompletedCampaign for POSTING submissions or FIRST_DRAFT/FINAL_DRAFT submissions from campaigns without campaignCredits
        const shouldCallHandleCompleted =
          result.photo.submission?.submissionType?.type === 'POSTING' ||
          ((result.photo.submission?.submissionType?.type === 'FIRST_DRAFT' ||
            result.photo.submission?.submissionType?.type === 'FINAL_DRAFT') &&
            result.photo.submission?.campaign?.campaignCredits === null);

        if (shouldCallHandleCompleted) {
          await handleCompletedCampaign(result.photo.submissionId as string, req.session.userid);
        }
      } else {
        // Even with preventStatusChange, we need to complete the campaign if there's no posting submission
        // and this is a POSTING submission, OR if this is a UGC campaign FIRST_DRAFT or FINAL_DRAFT
        const isUGCDraft =
          (result.photo.submission?.submissionType?.type === 'FIRST_DRAFT' ||
            result.photo.submission?.submissionType?.type === 'FINAL_DRAFT') &&
          result.photo.submission?.campaign?.campaignCredits === null;

        if (isUGCDraft) {
          await handleCompletedCampaign(result.photo.submissionId as string, req.session.userid);
        } else if (!result.postingSubmission || result.photo.submission?.submissionType?.type === 'POSTING') {
          await handleCompletedCampaign(result.photo.submissionId as string, req.session.userid);
        }
      }

      // Update kanban board
      await handleKanbanSubmission(result.photo.submissionId as string);
    }

    // Small delay to ensure all database operations are fully committed
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Send notification to creator
    const notification = await saveNotification({
      userId: result.photo.userId as string,
      message:
        status === 'APPROVED'
          ? `✅ Your photo has been approved in campaign ${result.photo.submission?.campaign?.name || 'Unknown Campaign'}`
          : `📝 Changes requested for your photo in campaign ${result.photo.submission?.campaign?.name || 'Unknown Campaign'}`,
      entity: Entity.Draft,
      entityId: result.photo.campaignId as string,
    });

    io.to(clients.get(result.photo.userId as string)).emit('notification', notification);
    io.to(clients.get(result.photo.userId as string)).emit('newFeedback');

    return res.status(200).json({
      success: true,
      message: `Photo ${status === 'APPROVED' ? 'approved' : 'changes requested'} successfully`,
      data: {
        mediaId,
        status: result.newStatus,
        url: result.photo.url,
      },
      reviewProgress: {
        allSectionsReviewed: result.allSectionsReviewed,
        photosAllReviewed: result.photosAllReviewed,
        videosAllReviewed: result.videosAllReviewed,
        rawFootagesAllReviewed: result.rawFootagesAllReviewed,
      },
    });
  } catch (error) {
    return res.status(500).json({
      message: 'Internal server error',
      error: error.message,
    });
  }
};

export const adminManageDraftVideosV2 = async (req: Request, res: Response) => {
  const { mediaId, status, feedback, reasons, preventStatusChange } = req.body;

  // Validate required fields
  if (!mediaId || !status) {
    return res.status(400).json({
      message: 'Missing required fields: mediaId and status are required',
    });
  }

  if (!['APPROVED', 'CHANGES_REQUIRED'].includes(status)) {
    return res.status(400).json({
      message: 'Invalid status. Must be "APPROVED" or "CHANGES_REQUIRED"',
    });
  }

  try {
    // Wrap everything in a transaction for data consistency
    const result = await prisma.$transaction(async (tx) => {
      // Find the video
      const video = await tx.video.findUnique({
        where: { id: mediaId },
        include: {
          submission: {
            include: {
              campaign: true,
              user: true,
              photos: true,
              video: true,
              rawFootages: true,
              submissionType: true,
            },
          },
        },
      });

      if (!video) {
        throw new Error('Video not found');
      }

      // Update ONLY this specific video's status
      const newStatus = status === 'APPROVED' ? 'APPROVED' : 'REVISION_REQUESTED';

      await tx.video.update({
        where: { id: mediaId },
        data: { status: newStatus },
      });

      // Enhanced feedback system - store individual feedback with media ID reference
      if (feedback) {
        // Clean the reasons array to remove any null/undefined values
        const cleanReasons = Array.isArray(reasons)
          ? reasons.filter((reason) => reason !== null && reason !== undefined && reason !== '')
          : reasons
            ? [reasons]
            : [];

        await tx.feedback.create({
          data: {
            content: feedback,
            adminId: req.session.userid as string,
            submissionId: video.submissionId as string,
            type: status === 'APPROVED' ? 'COMMENT' : 'REQUEST',
            videosToUpdate: [mediaId], // Always include media ID for both approved and changes required
            reasons: cleanReasons,
          },
        });
      }

      // Log admin activity for video management
      if (video.campaignId && req.session.userid) {
        const admin = await tx.user.findUnique({ where: { id: req.session.userid }, include: { admin: true } });
        const adminName = admin?.name || 'Admin';
        const actionType = status === 'APPROVED' ? 'approved' : 'requested changes to';
        const submissionTypeName =
          video.submission?.submissionType?.type === 'FIRST_DRAFT' ? 'first draft' : 'final draft';
        const logMessage = `Admin "${adminName}" ${actionType} ${submissionTypeName} video for creator "${video.submission?.user?.name || 'Unknown'}"`;
        await logChange(logMessage, video.campaignId, req);
      }

      // Check if we should update submission status based on overall review progress
      if (!video.submission) {
        throw new Error('Submission not found');
      }

      const campaign = video.submission.campaign;
      const submission = video.submission;

      // Get current status of all media in this submission after this update
      const allVideos = await tx.video.findMany({
        where: {
          submissionId: video.submissionId,
          userId: video.userId,
          campaignId: video.campaignId,
        },
      });

      const allPhotos = await tx.photo.findMany({
        where: {
          submissionId: video.submissionId,
          userId: video.userId,
          campaignId: video.campaignId,
        },
      });

      const allRawFootages = await tx.rawFootage.findMany({
        where: {
          submissionId: video.submissionId,
          userId: video.userId,
          campaignId: video.campaignId,
        },
      });

      // Determine which sections are required for this campaign
      const requiresVideos = true; // Videos are always required
      const requiresRawFootages = campaign.rawFootage === true;
      const requiresPhotos = campaign.photos === true;

      // Check if all required media items have been reviewed (either approved or revision requested)
      const videosAllReviewed =
        !requiresVideos ||
        allVideos.length === 0 ||
        allVideos.every((v) => v.status === 'APPROVED' || v.status === 'REVISION_REQUESTED');

      const photosAllReviewed =
        !requiresPhotos ||
        allPhotos.length === 0 ||
        allPhotos.every((p) => p.status === 'APPROVED' || p.status === 'REVISION_REQUESTED');

      const rawFootagesAllReviewed =
        !requiresRawFootages ||
        allRawFootages.length === 0 ||
        allRawFootages.every((rf) => rf.status === 'APPROVED' || rf.status === 'REVISION_REQUESTED');

      // Only update submission status if all required sections have been fully reviewed
      const allSectionsReviewed = videosAllReviewed && photosAllReviewed && rawFootagesAllReviewed;

      let submissionUpdated = false;
      let postingSubmission = null;

      if (allSectionsReviewed) {
        // Check final approval status
        const videosApproved =
          !requiresVideos || allVideos.length === 0 || allVideos.every((v) => v.status === 'APPROVED');

        const photosApproved =
          !requiresPhotos || allPhotos.length === 0 || allPhotos.every((p) => p.status === 'APPROVED');

        const rawFootagesApproved =
          !requiresRawFootages || allRawFootages.length === 0 || allRawFootages.every((rf) => rf.status === 'APPROVED');

        // Check if any required section has changes requested
        const videosHaveChanges = requiresVideos && allVideos.some((v) => v.status === 'REVISION_REQUESTED');

        const photosHaveChanges = requiresPhotos && allPhotos.some((p) => p.status === 'REVISION_REQUESTED');

        const rawFootagesHaveChanges =
          requiresRawFootages && allRawFootages.some((rf) => rf.status === 'REVISION_REQUESTED');

        if (videosApproved && photosApproved && rawFootagesApproved) {
          // All sections approved - update to APPROVED
          await tx.submission.update({
            where: { id: video.submissionId as string },
            data: {
              status: 'APPROVED',
              completedAt: new Date(),
              approvedByAdminId: req.session.userid as string,
            },
          });

          submissionUpdated = true;

          // Log consolidated admin activity for submission approval
          if (video.campaignId && req.session.userid) {
            const admin = await tx.user.findUnique({ where: { id: req.session.userid } });
            const adminName = admin?.name || 'Admin';
            const submissionTypeName =
              video.submission?.submissionType?.type === 'FIRST_DRAFT' ? 'First Draft' : 'Final Draft';
            const adminActivityMessage = `${adminName} approved ${video.submission?.user?.name || 'Unknown'}'s ${submissionTypeName}`;
            await logChange(adminActivityMessage, video.campaignId, req);
          }

          // Only do full workflow logic if preventStatusChange is not true
          if (!preventStatusChange) {
            // Handle next steps based on submission type
            if (submission.submissionType.type === 'FIRST_DRAFT') {
              // Activate posting submission
              postingSubmission = await tx.submission.findFirst({
                where: {
                  userId: submission.userId,
                  campaignId: submission.campaignId,
                  submissionType: { type: 'POSTING' },
                },
              });

              if (postingSubmission) {
                await tx.submission.update({
                  where: { id: postingSubmission.id },
                  data: { status: 'IN_PROGRESS' },
                });
              }
            } else if (submission.submissionType.type === 'FINAL_DRAFT') {
              // Activate posting submission for final draft
              postingSubmission = await tx.submission.findFirst({
                where: {
                  userId: submission.userId,
                  campaignId: submission.campaignId,
                  submissionType: { type: 'POSTING' },
                },
              });

              if (postingSubmission) {
                // Calculate 3 days from today (not from current timestamp)
                const threeDaysFromToday = new Date();
                threeDaysFromToday.setDate(threeDaysFromToday.getDate() + 3);
                threeDaysFromToday.setHours(23, 59, 59, 999); // Set to end of day

                await tx.submission.update({
                  where: { id: postingSubmission.id },
                  data: {
                    status: 'IN_PROGRESS',
                    dueDate: threeDaysFromToday,
                    startDate: threeDaysFromToday,
                    endDate: threeDaysFromToday,
                  },
                });
              }
            }
          } else {
            // Even with preventStatusChange, we need to check for posting submission
            postingSubmission = await tx.submission.findFirst({
              where: {
                userId: submission.userId,
                campaignId: submission.campaignId,
                submissionType: { type: 'POSTING' },
              },
            });
          }
        } else if (videosHaveChanges || photosHaveChanges || rawFootagesHaveChanges) {
          // Some sections have changes requested - update to CHANGES_REQUIRED
          await tx.submission.update({
            where: { id: video.submissionId as string },
            data: { status: 'CHANGES_REQUIRED' },
          });

          submissionUpdated = true;

          // Log consolidated admin activity for changes requested
          if (video.campaignId && req.session.userid) {
            const admin = await tx.user.findUnique({ where: { id: req.session.userid } });
            const adminName = admin?.name || 'Admin';
            const submissionTypeName =
              video.submission?.submissionType?.type === 'FIRST_DRAFT' ? 'First Draft' : 'Final Draft';
            const adminActivityMessage = `${adminName} requested changes on ${video.submission?.user?.name || 'Unknown'}'s ${submissionTypeName}`;
            await logChange(adminActivityMessage, video.campaignId, req);
          }

          // Always activate Final Draft when changes are requested, regardless of preventStatusChange
          // This is essential for the workflow to function properly
          if (submission.submissionType.type === 'FIRST_DRAFT') {
            const finalDraftSubmission = await tx.submission.findFirst({
              where: {
                userId: submission.userId,
                campaignId: submission.campaignId,
                submissionType: { type: 'FINAL_DRAFT' },
              },
            });

            if (finalDraftSubmission) {
              await tx.submission.update({
                where: { id: finalDraftSubmission.id },
                data: { status: 'IN_PROGRESS' },
              });
            }
          }
        }
      }

      return {
        video,
        submission,
        newStatus,
        submissionUpdated,
        allSectionsReviewed,
        videosAllReviewed: videosAllReviewed,
        photosAllReviewed: photosAllReviewed,
        rawFootagesAllReviewed: rawFootagesAllReviewed,
        postingSubmission,
      };
    });

    // Handle post-transaction operations (outside transaction for performance)
    if (result.submissionUpdated) {
      // Handle completed campaign logic if needed
      if (!preventStatusChange) {
        // Only call handleCompletedCampaign for POSTING submissions or FIRST_DRAFT submissions from campaigns without campaignCredits
        const shouldCallHandleCompleted =
          result.video.submission?.submissionType?.type === 'POSTING' ||
          ((result.video.submission?.submissionType?.type === 'FIRST_DRAFT' ||
            result.video.submission?.submissionType?.type === 'FINAL_DRAFT') &&
            result.video.submission?.campaign?.campaignCredits === null);

        if (shouldCallHandleCompleted) {
          await handleCompletedCampaign(result.video.submissionId as string, req.session.userid);
        }
      } else {
        // Special case: For campaigns without campaignCredits (UGC campaigns), we still need to complete
        // the campaign when FIRST_DRAFT or FINAL_DRAFT is approved, even with preventStatusChange
        const isUGCDraft =
          (result.video.submission?.submissionType?.type === 'FIRST_DRAFT' ||
            result.video.submission?.submissionType?.type === 'FINAL_DRAFT') &&
          result.video.submission?.campaign?.campaignCredits === null;

        if (isUGCDraft) {
          await handleCompletedCampaign(result.video.submissionId as string, req.session.userid);
        } else if (!result.postingSubmission || result.video.submission?.submissionType?.type === 'POSTING') {
          await handleCompletedCampaign(result.video.submissionId as string, req.session.userid);
        }
      }

      // Update kanban board
      await handleKanbanSubmission(result.video.submissionId as string);
    }

    // Small delay to ensure all database operations are fully committed
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Send notification to creator
    const notification = await saveNotification({
      userId: result.video.userId as string,
      message:
        status === 'APPROVED'
          ? `✅ Your video has been approved in campaign ${result.video.submission?.campaign?.name || 'Unknown Campaign'}`
          : `📝 Changes requested for your video in campaign ${result.video.submission?.campaign?.name || 'Unknown Campaign'}`,
      entity: Entity.Draft,
      entityId: result.video.campaignId as string,
    });

    io.to(clients.get(result.video.userId as string)).emit('notification', notification);
    io.to(clients.get(result.video.userId as string)).emit('newFeedback');

    return res.status(200).json({
      success: true,
      message: `Video ${status === 'APPROVED' ? 'approved' : 'changes requested'} successfully`,
      data: {
        mediaId,
        status: result.newStatus,
        url: result.video.url,
      },
      reviewProgress: {
        allSectionsReviewed: result.allSectionsReviewed,
        videosAllReviewed: result.videosAllReviewed,
        photosAllReviewed: result.photosAllReviewed,
        rawFootagesAllReviewed: result.rawFootagesAllReviewed,
      },
    });
  } catch (error) {
    return res.status(500).json({
      message: 'Internal server error',
      error: error.message,
    });
  }
};

export const adminManageRawFootagesV2 = async (req: Request, res: Response) => {
  const { mediaId, status, feedback, reasons, preventStatusChange } = req.body;

  // Validate required fields
  if (!mediaId || !status) {
    return res.status(400).json({
      message: 'Missing required fields: mediaId and status are required',
    });
  }

  if (!['APPROVED', 'CHANGES_REQUIRED'].includes(status)) {
    return res.status(400).json({
      message: 'Invalid status. Must be "APPROVED" or "CHANGES_REQUIRED"',
    });
  }

  try {
    // Wrap everything in a transaction for data consistency
    const result = await prisma.$transaction(async (tx) => {
      // Find the raw footage
      const rawFootage = await tx.rawFootage.findUnique({
        where: { id: mediaId },
        include: {
          submission: {
            include: {
              campaign: true,
              user: true,
              photos: true,
              video: true,
              rawFootages: true,
              submissionType: true,
            },
          },
        },
      });

      if (!rawFootage) {
        throw new Error('Raw footage not found');
      }

      // Update ONLY this specific raw footage's status
      const newStatus = status === 'APPROVED' ? 'APPROVED' : 'REVISION_REQUESTED';

      await tx.rawFootage.update({
        where: { id: mediaId },
        data: { status: newStatus },
      });

      // Enhanced feedback system - store individual feedback with media ID reference
      if (feedback) {
        // Clean the reasons array to remove any null/undefined values
        const cleanReasons = Array.isArray(reasons)
          ? reasons.filter((reason) => reason !== null && reason !== undefined && reason !== '')
          : reasons
            ? [reasons]
            : [];

        await tx.feedback.create({
          data: {
            rawFootageContent: feedback,
            adminId: req.session.userid as string,
            submissionId: rawFootage.submissionId as string,
            type: status === 'APPROVED' ? 'COMMENT' : 'REQUEST',
            rawFootageToUpdate: [mediaId], // Always include media ID for both approved and changes required
            reasons: cleanReasons,
          },
        });
      }

      // Log admin activity for raw footage management
      if (rawFootage.campaignId && req.session.userid) {
        const admin = await tx.user.findUnique({ where: { id: req.session.userid }, include: { admin: true } });
        const adminName = admin?.name || 'Admin';
        const actionType = status === 'APPROVED' ? 'approved' : 'requested changes to';
        const submissionTypeName =
          rawFootage.submission?.submissionType?.type === 'FIRST_DRAFT' ? 'first draft' : 'final draft';
        const logMessage = `Admin "${adminName}" ${actionType} ${submissionTypeName} raw footage for creator "${rawFootage.submission?.user?.name || 'Unknown'}"`;
        await logChange(logMessage, rawFootage.campaignId, req);
      }

      // Check if we should update submission status based on overall review progress
      if (!rawFootage.submission) {
        throw new Error('Submission not found');
      }

      const campaign = rawFootage.submission.campaign;
      const submission = rawFootage.submission;

      // Get current status of all media in this submission after this update
      const allRawFootages = await tx.rawFootage.findMany({
        where: {
          submissionId: rawFootage.submissionId,
          userId: rawFootage.userId,
          campaignId: rawFootage.campaignId,
        },
      });

      const allVideos = await tx.video.findMany({
        where: {
          submissionId: rawFootage.submissionId,
          userId: rawFootage.userId,
          campaignId: rawFootage.campaignId,
        },
      });

      const allPhotos = await tx.photo.findMany({
        where: {
          submissionId: rawFootage.submissionId,
          userId: rawFootage.userId,
          campaignId: rawFootage.campaignId,
        },
      });

      // Determine which sections are required for this campaign
      const requiresVideos = true; // Videos are always required
      const requiresRawFootages = campaign.rawFootage === true;
      const requiresPhotos = campaign.photos === true;

      // Check if all required media items have been reviewed (either approved or revision requested)
      const rawFootagesAllReviewed =
        !requiresRawFootages ||
        allRawFootages.length === 0 ||
        allRawFootages.every((rf) => rf.status === 'APPROVED' || rf.status === 'REVISION_REQUESTED');
      const videosAllReviewed =
        !requiresVideos ||
        allVideos.length === 0 ||
        allVideos.every((v) => v.status === 'APPROVED' || v.status === 'REVISION_REQUESTED');
      const photosAllReviewed =
        !requiresPhotos ||
        allPhotos.length === 0 ||
        allPhotos.every((p) => p.status === 'APPROVED' || p.status === 'REVISION_REQUESTED');

      // Only update submission status if all required sections have been fully reviewed
      const allSectionsReviewed = rawFootagesAllReviewed && videosAllReviewed && photosAllReviewed;

      let submissionUpdated = false;
      let postingSubmission = null;

      if (allSectionsReviewed) {
        // Check final approval status
        const rawFootagesApproved =
          !requiresRawFootages || allRawFootages.length === 0 || allRawFootages.every((rf) => rf.status === 'APPROVED');
        const videosApproved =
          !requiresVideos || allVideos.length === 0 || allVideos.every((v) => v.status === 'APPROVED');
        const photosApproved =
          !requiresPhotos || allPhotos.length === 0 || allPhotos.every((p) => p.status === 'APPROVED');

        // Check if any required section has changes requested
        const rawFootagesHaveChanges =
          requiresRawFootages && allRawFootages.some((rf) => rf.status === 'REVISION_REQUESTED');
        const videosHaveChanges = requiresVideos && allVideos.some((v) => v.status === 'REVISION_REQUESTED');
        const photosHaveChanges = requiresPhotos && allPhotos.some((p) => p.status === 'REVISION_REQUESTED');

        if (rawFootagesApproved && videosApproved && photosApproved) {
          // All sections approved - update to APPROVED
          await tx.submission.update({
            where: { id: rawFootage.submissionId as string },
            data: {
              status: 'APPROVED',
              completedAt: new Date(),
              approvedByAdminId: req.session.userid as string,
            },
          });

          submissionUpdated = true;

          // Log consolidated admin activity for submission approval
          if (rawFootage.campaignId && req.session.userid) {
            const admin = await tx.user.findUnique({ where: { id: req.session.userid } });
            const adminName = admin?.name || 'Admin';
            const submissionTypeName =
              rawFootage.submission?.submissionType?.type === 'FIRST_DRAFT' ? 'First Draft' : 'Final Draft';
            const adminActivityMessage = `${adminName} approved ${rawFootage.submission?.user?.name || 'Unknown'}'s ${submissionTypeName}`;
            await logChange(adminActivityMessage, rawFootage.campaignId, req);
          }

          // Only do full workflow logic if preventStatusChange is not true
          if (!preventStatusChange) {
            // Handle next steps based on submission type
            if (submission.submissionType.type === 'FIRST_DRAFT') {
              // Activate posting submission
              postingSubmission = await tx.submission.findFirst({
                where: {
                  userId: submission.userId,
                  campaignId: submission.campaignId,
                  submissionType: { type: 'POSTING' },
                },
              });

              if (postingSubmission) {
                // Calculate 3 days from today (not from current timestamp)
                const threeDaysFromToday = new Date();
                threeDaysFromToday.setDate(threeDaysFromToday.getDate() + 3);
                threeDaysFromToday.setHours(23, 59, 59, 999); // Set to end of day

                await tx.submission.update({
                  where: { id: postingSubmission.id },
                  data: {
                    status: 'IN_PROGRESS',
                    dueDate: threeDaysFromToday,
                    startDate: threeDaysFromToday,
                    endDate: threeDaysFromToday,
                  },
                });
              }
            } else if (submission.submissionType.type === 'FINAL_DRAFT') {
              // Activate posting submission for final draft
              postingSubmission = await tx.submission.findFirst({
                where: {
                  userId: submission.userId,
                  campaignId: submission.campaignId,
                  submissionType: { type: 'POSTING' },
                },
              });

              if (postingSubmission) {
                // Calculate 3 days from today (not from current timestamp)
                const threeDaysFromToday = new Date();
                threeDaysFromToday.setDate(threeDaysFromToday.getDate() + 3);
                threeDaysFromToday.setHours(23, 59, 59, 999); // Set to end of day

                await tx.submission.update({
                  where: { id: postingSubmission.id },
                  data: {
                    status: 'IN_PROGRESS',
                    dueDate: threeDaysFromToday,
                    startDate: threeDaysFromToday,
                    endDate: threeDaysFromToday,
                  },
                });
              }
            }
          } else {
            // Even with preventStatusChange, we need to check for posting submission
            postingSubmission = await tx.submission.findFirst({
              where: {
                userId: submission.userId,
                campaignId: submission.campaignId,
                submissionType: { type: 'POSTING' },
              },
            });
          }
        } else if (rawFootagesHaveChanges || videosHaveChanges || photosHaveChanges) {
          // Some sections have changes requested - update to CHANGES_REQUIRED
          await tx.submission.update({
            where: { id: rawFootage.submissionId as string },
            data: { status: 'CHANGES_REQUIRED' },
          });

          submissionUpdated = true;

          // Log consolidated admin activity for changes requested
          if (rawFootage.campaignId && req.session.userid) {
            const admin = await tx.user.findUnique({ where: { id: req.session.userid } });
            const adminName = admin?.name || 'Admin';
            const submissionTypeName =
              rawFootage.submission?.submissionType?.type === 'FIRST_DRAFT' ? 'First Draft' : 'Final Draft';
            const adminActivityMessage = `${adminName} requested changes on ${rawFootage.submission?.user?.name || 'Unknown'}'s ${submissionTypeName}`;
            await logChange(adminActivityMessage, rawFootage.campaignId, req);
          }

          // Always activate Final Draft when changes are requested, regardless of preventStatusChange
          // This is essential for the workflow to function properly
          if (submission.submissionType.type === 'FIRST_DRAFT') {
            const finalDraftSubmission = await tx.submission.findFirst({
              where: {
                userId: submission.userId,
                campaignId: submission.campaignId,
                submissionType: { type: 'FINAL_DRAFT' },
              },
            });

            if (finalDraftSubmission) {
              await tx.submission.update({
                where: { id: finalDraftSubmission.id },
                data: { status: 'IN_PROGRESS' },
              });
            }
          }
        }
      }

      return {
        rawFootage,
        submission,
        newStatus,
        submissionUpdated,
        allSectionsReviewed,
        rawFootagesAllReviewed: rawFootagesAllReviewed,
        videosAllReviewed: videosAllReviewed,
        photosAllReviewed: photosAllReviewed,
        postingSubmission,
      };
    });

    // Handle post-transaction operations (outside transaction for performance)
    if (result.submissionUpdated) {
      // Handle completed campaign logic if needed
      if (!preventStatusChange) {
        // Only call handleCompletedCampaign for POSTING submissions or FIRST_DRAFT submissions from campaigns without campaignCredits
        const shouldCallHandleCompleted =
          result.submission?.submissionType?.type === 'POSTING' ||
          ((result.submission?.submissionType?.type === 'FIRST_DRAFT' ||
            result.submission?.submissionType?.type === 'FINAL_DRAFT') &&
            result.submission?.campaign?.campaignCredits === null);

        if (shouldCallHandleCompleted) {
          await handleCompletedCampaign(result.rawFootage.submissionId as string, req.session.userid);
        }
      } else {
        // Even with preventStatusChange, we need to complete the campaign if there's no posting submission

        // and this is a POSTING submission, OR if this is a UGC campaign FIRST_DRAFT
        const isUGCFirstDraft =
          (result.submission?.submissionType?.type === 'FIRST_DRAFT' ||
            result.submission?.submissionType?.type === 'FINAL_DRAFT') &&
          result.submission?.campaign?.campaignCredits === null;

        if (isUGCFirstDraft) {
          await handleCompletedCampaign(result.rawFootage.submissionId as string, req.session.userid);
        } else if (!result.postingSubmission || result.submission?.submissionType?.type === 'POSTING') {
          await handleCompletedCampaign(result.rawFootage.submissionId as string, req.session.userid);
        }
      }

      // Update kanban board
      await handleKanbanSubmission(result.rawFootage.submissionId as string);
    }

    // Small delay to ensure all database operations are fully committed
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Send notification to creator
    const notification = await saveNotification({
      userId: result.rawFootage.userId as string,
      message:
        status === 'APPROVED'
          ? `✅ Your raw footage has been approved in campaign ${result.rawFootage.submission?.campaign?.name || 'Unknown Campaign'}`
          : `📝 Changes requested for your raw footage in campaign ${result.rawFootage.submission?.campaign?.name || 'Unknown Campaign'}`,
      entity: Entity.Draft,
      entityId: result.rawFootage.campaignId as string,
    });

    io.to(clients.get(result.rawFootage.userId as string)).emit('notification', notification);
    io.to(clients.get(result.rawFootage.userId as string)).emit('newFeedback');

    return res.status(200).json({
      success: true,
      message: `Raw footage ${status === 'APPROVED' ? 'approved' : 'changes requested'} successfully`,
      data: {
        mediaId,
        status: result.newStatus,
        url: result.rawFootage.url,
      },
      reviewProgress: {
        allSectionsReviewed: result.allSectionsReviewed,
        rawFootagesAllReviewed: result.rawFootagesAllReviewed,
        videosAllReviewed: result.videosAllReviewed,
        photosAllReviewed: result.photosAllReviewed,
      },
    });
    // Catch error
  } catch (error) {
    return res.status(500).json({
      message: 'Internal server error',
      error: error.message,
    });
  }
};

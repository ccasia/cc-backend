import { Request, Response } from 'express';
import { Entity, PrismaClient, SubmissionStatus } from '@prisma/client';
import { uploadAgreementForm, uploadPitchVideo } from '@configs/cloudStorage.config';
import { saveNotification } from './notificationController';
import { activeProcesses, clients, io } from '../server';
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
import { createNewRowData } from '@services/google_sheets/sheets';
import { createNewTask, getTaskId, updateTask } from '@services/kanbanService';
import { deductCredits } from '@services/campaignServices';

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
        rawFootages: true,
        photos: true,
        publicFeedback: true,
        video: true,
      },
    });

    return res.status(200).json(data);
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const draftSubmission = async (req: Request, res: Response) => {
  try {
    const { submissionId, caption } = JSON.parse(req.body.data);
    const files = req.files as any;
    
//   const { submissionId, caption } = JSON.parse(req.body.data);
//   const files = req.files as any;

  try {
    // Handle multiple draft videos
    const draftVideos = Array.isArray(files?.draftVideo) ? 
      files.draftVideo 
      : files?.draftVideo 
      ? [files.draftVideo] 
      : [];

    // Handle multiple raw footages
    const rawFootages = Array.isArray(files?.rawFootage) ?
      files.rawFootage
      : files?.rawFootage
      ? [files.rawFootage]
      : [];

    // Handle multiple photos
    const photos = Array.isArray(files?.photos) ?
      files.photos
      : files?.photos
      ? [files.photos]
      : [];

    const userid = req.session.userid;

    let amqp: amqplib.Connection | null = null;
    let channel: amqplib.Channel | null = null;

    try {
      const submission = await prisma.submission.findUnique({
        where: {
          id: submissionId,
        },
        include: {
          submissionType: true,
          task: true,
          user: {
            include: {
              creator: true,
              Board: true,
            },
          },
          campaign: {
            select: {
              spreadSheetURL: true,
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

      // Move task creator from in progress to in review
      if (submission.user.Board) {
        const taskInProgress = await getTaskId({
          columnName: 'In Progress',
          boardId: submission.user.Board.id,
          submissionId: submission.id,
        });

        if (taskInProgress) {
          await prisma.task.update({
            where: {
              id: taskInProgress.id,
            },
            data: {
              //  columnId: inReviewColumn,
            },
          });
        }
      }

      const filePaths: any = {};

      if (draftVideos && draftVideos.length > 0) {
        filePaths.video = [];
      
        for (const draftVideo of draftVideos) {
          const draftVideoPath = `/tmp/${submissionId}_${draftVideo.name}`;
      
          // Move the draft video to the desired path
          await draftVideo.mv(draftVideoPath);
          console.log('Draft video moved to:', draftVideoPath);

          // Add to filePaths.video array
          filePaths.video.push({
            inputPath: draftVideoPath,
            outputPath: `/tmp/${submissionId}_${draftVideo.name.replace('.mp4','')}_compressed.mp4`,
            fileName: `${submissionId}_${draftVideo.name}`,
          });
        }
      }
   
      if (rawFootages) {
        console.log("Raw Footages received:", rawFootages);
      
        const rawFootageArray = Array.isArray(rawFootages) ? rawFootages : [rawFootages];
      
        if (rawFootageArray.length > 0) {
          filePaths.rawFootages = [];
      
          for (const rawFootage of rawFootageArray) {
            const rawFootagePath = `/tmp/${submissionId}_${rawFootage.name}`;
            try {
              await rawFootage.mv(rawFootagePath);
              filePaths.rawFootages.push(rawFootagePath);
            } catch (err) {
              console.error("Error moving file:", err);
            }
          }
        }
      }
      


      if (photos && photos.length > 0) {
        filePaths.photos = [];
        for (const photo of photos) {
          const photoPath = `/tmp/${submissionId}_${photo.name}`;
          await photo.mv(photoPath);
          filePaths.photos.push(photoPath);
        }
      }

      console.log('filePaths:', filePaths);

      amqp = await amqplib.connect(process.env.RABBIT_MQ as string);
      channel = await amqp.createChannel();

      await channel.assertQueue('draft');

      // console.log("submission", submission)
      console.log("📤 Sending to RabbitMQ:", JSON.stringify({
        userid,
        submissionId,
        campaignId: submission?.campaignId,
        folder: submission?.submissionType.type,
        caption,
        admins: submission.campaign.campaignAdmin,
        filePaths,
      }, null, 2));
      
      channel.sendToQueue(
        'draft',
        Buffer.from(
          JSON.stringify({
            userid,
            submissionId,
            campaignId: submission?.campaignId,
            folder: submission?.submissionType.type,
            caption,
            admins: submission.campaign.campaignAdmin,
            filePaths,
          }),
        ),
        { persistent: true }
      );


      activeProcesses.set(submissionId, { status: 'queue' });

      // if (submission.campaign.spreadSheetURL) {
      //   const spreadSheetId = submission.campaign.spreadSheetURL.split('/d/')[1].split('/')[0];

      //   await createNewRowData({
      //     creatorInfo: {
      //       name: submission.user.name,
      //       username: submission.user.creator?.instagram,
      //       postingDate: dayjs().format('LL'),
      //       caption: caption,
      //       videoLink: `https://storage.googleapis.com/${process.env.BUCKET_NAME as string}/${submission?.submissionType.type}/${`${submission?.id}_draft.mp4`}?v=${dayjs().format()}`,
      //     } as any,
      //     spreadSheetId: spreadSheetId,
      //   });
      // }

      return res.status(200).json({ message: 'Video start processing' });
    } catch (error) {
      console.error('Draft submission error:', error);
      return res.status(400).json({ message: 'Failed to process submission', error });
    } finally {
      if (channel) await channel.close();
      if (amqp) await amqp.close();
    }
  } catch (error) {
    console.error('Draft submission error:', error);
    return res.status(400).json({ message: 'Failed to process submission', error });
  }
};
export const adminManageDraft = async (req: Request, res: Response) => {
  const { submissionId, feedback, type, reasons, userId, videosToUpdate } = req.body;

  try {
    const submission = await prisma.submission.findUnique({
      where: {
        id: submissionId,
      },
      include: {
        feedback: true,
        publicFeedback: true,
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


//     await prisma.$transaction(async (prisma) => {
//       if (type === 'approve') {
//         const approveSubmission = await prisma.submission.update({
//           where: {
//             id: submission?.id,
//           },
//           data: {
//             status: 'APPROVED',
//             isReview: true,
//             feedback: feedback && {
//               create: {
//                 type: 'COMMENT',
//                 content: feedback,

//                 adminId: req.session.userid as string,
//               },

    await prisma.$transaction(
      async (prisma) => {
        if (type === 'approve') {
          const approveSubmission = await prisma.submission.update({
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

          const doneColumnId = await getColumnId({ userId: submission.userId, columnName: 'Done' });

          if (approveSubmission.user.Board) {
            const task = await getTaskId({
              boardId: approveSubmission?.user.Board.id,
              submissionId: approveSubmission.id,
              columnName: 'In Review',
            });

            if (task && doneColumnId) {
              await prisma.task.update({
                where: {
                  id: task.id,
                },
                data: {
                  columnId: doneColumnId,
                },
              });
            }
          }

          const image: any = submission?.campaign?.campaignBrief?.images || [];

          if (submission.submissionType.type === 'FIRST_DRAFT' && submission.status === 'APPROVED') {
            approvalOfDraft(
              submission.user.email,
              submission.campaign.name,
              submission.user.name ?? 'Creator',
              submission.campaignId,
              image[0],
            );
          } else if (
            (submission.submissionType.type === 'FINAL_DRAFT' && submission.status === 'APPROVED',
            submission.campaignId)
          ) {
            approvalOfDraft(
              submission.user.email,
              submission.campaign.name,
              submission.user.name ?? 'Creator',
              submission.campaignId,
              image[0],
            );
          } else {
            feedbackOnDraft(
              submission.user.email,
              submission.campaign.name,
              submission.user.name ?? 'Creator',
              submission.campaignId,
            );
          }

          if (submission.campaign.campaignType == 'ugc') {
            const invoiceAmount = submission.user.creatorAgreement.find(
              (elem: any) => elem.campaignId === submission.campaign.id,
            )?.amount;

            await deductCredits(approveSubmission.campaignId, approveSubmission.userId, prisma as PrismaClient);

            // await deductCredits(submission.campaignId, submission.userId);

            const company = await prisma.company.findUnique({
              where: {
                id: submission.campaign.companyId as any,
              },
              // include: {
              //   PackagesClient: {
              //     where: {
              //       status: 'active',
              //     },
              //   },
              // },
            });
            // if (company?.PackagesClient.length) {
            //   await prisma.packagesClient.update({
            //     where: {
            //       id: company?.PackagesClient[0].id,
            //     },
            //     data: {
            //       creditsUtilized: {
            //         increment: 1,
            //       },
            //       availableCredits: {
            //         decrement: 1,
            //       },
            //     },
            //   });
            // }

            const invoice = await createInvoiceService(submission, userId, invoiceAmount);

            const shortlistedCreator = await prisma.shortListedCreator.findFirst({
              where: {
                AND: [{ userId: submission.userId }, { campaignId: submission.campaignId }],
              },
            });

            if (!shortlistedCreator) {
              throw new Error('Shortlisted creator not found.');
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

          if (submission.campaign.campaignType === 'normal') {
            const posting = await prisma.submission.findFirst({
              where: {
                AND: [
                  { userId: submission.userId },
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
              await prisma.task.update({
                where: {
                  id: task?.id,
                },
                data: {
                  columnId: inProgressColumnId,
                },
              });
            }

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

            const images: any = posting.campaign.campaignBrief?.images;

            postingSchedule(
              submission.user.email,
              submission.campaign.name,
              submission.user.name ?? 'Creator',
              submission.campaign.id,
              images[0],
            );
          }

          for (const item of submission.campaign.campaignAdmin) {
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
                await prisma.task.update({
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
            submission.campaign.name,
            MAP_TIMELINE[submission.submissionType.type],
          );

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
                videosToUpdate: videosToUpdate || [], 
                content: feedback,
                admin: {
                  connect: { id: req.session.userid },

//           return res.status(200).json({ message: 'Succesfully submitted.' });
//         } else {
//           const sub = await prisma.submission.update({
//             where: {
//               id: submissionId,
//             },
//             data: {
//               status: 'CHANGES_REQUIRED',
//               isReview: true,
//               feedback: {
//                 create: {
//                   type: 'REASON',
//                   reasons: reasons,
//                   content: feedback,
//                   admin: {
//                     connect: { id: req.session.userid },
//                   },

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

          if (inReviewId) {
            const inReviewColumn = await prisma.columns.findUnique({
              where: {
                id: inReviewId,
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
          } else if (sub.submissionType.type === 'FINAL_DRAFT') {
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

          for (const item of sub.campaign.campaignAdmin) {
            if (item.admin.user.Board) {
              const task = await getTaskId({
                boardId: item.admin.user.Board?.id,
                submissionId: sub.id,
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
      },
      {
        isolationLevel: 'RepeatableRead',
      },
    );
  } catch (error) {
    return res.status(400).json(error?.message);
  }
};

// export const adminManagePosting = async (req: Request, res: Response) => {
//   const { status, submissionId } = req.body;

//   const userId = req.session.userid;

//   try {
//     const submission = await prisma.submission.findUnique({
//       where: {
//         id: submissionId,
//       },
//       include: {
//         user: {
//           include: {
//             creator: true,
//             paymentForm: true,
//             creatorAgreement: true,
//             Board: true,
//           },
//         },
//         campaign: {
//           include: {
//             campaignBrief: true,
//             campaignAdmin: {
//               include: {
//                 admin: {
//                   select: {
//                     role: true,
//                     user: {
//                       select: {
//                         Board: true,
//                         id: true,
//                       },
//                     },
//                   },
//                 },
//               },
//             },
//           },
//         },
//         task: true,
//       },
//     });

//     if (!submission) {
//       return res.status(404).json({ message: 'Submission not found.' });
//     }

//     if (status === 'APPROVED') {
//       await prisma.submission.update({
//         where: {
//           id: submission.id,
//         },
//         data: {
//           status: status as SubmissionStatus,
//           isReview: true,
//         },
//       });

//       const inReviewColumn = await getColumnId({ userId: submission?.userId, columnName: 'In Review' });

//       const doneColumnId = await getColumnId({ userId: submission?.userId, columnName: 'Done' });

//       const taskInReview = submission.task.find((item) => item.columnId === inReviewColumn);

//       // Move from column in review to Done
//       await prisma.task.update({
//         where: {
//           id: taskInReview?.id,
//         },
//         data: {
//           columnId: doneColumnId,
//         },
//       });

//       const invoiceAmount = submission.user.creatorAgreement.find(
//         (elem) => elem.campaignId === submission.campaign.id,
//       )?.amount;

//       const invoice = await createInvoiceService(submission, userId, invoiceAmount);

//       const shortlistedCreator = await prisma.shortListedCreator.findFirst({
//         where: {
//           AND: [{ userId: submission.userId }, { campaignId: submission.campaignId }],
//         },
//       });

//       if (!shortlistedCreator) {
//         return res.status(404).json({ message: 'Shortlisted creator not found.' });
//       }

//       await prisma.shortListedCreator.update({
//         where: {
//           id: shortlistedCreator.id,
//         },
//         data: {
//           isCampaignDone: true,
//         },
//       });

//       const notification = await saveNotification({
//         userId: submission.userId,
//         message: ` ✅ Your posting has been approved for campaign ${submission.campaign.name}`,
//         entity: Entity.Post,
//         entityId: submission.campaignId,
//       });

//       io.to(clients.get(submission.userId)).emit('notification', notification);
//       io.to(clients.get(submission.userId)).emit('newFeedback');

//       const { title, message } = notificationInvoiceGenerate(submission.campaign.name);

//       // Notify each admin with the "Finance" role
//       for (const admin of submission.campaign.campaignAdmin) {
//         if (admin?.admin?.role?.name === 'Finance') {
//           const notification = await saveNotification({
//             userId: admin.adminId,
//             title,
//             message,
//             invoiceId: invoice?.id,
//             entity: 'Invoice',
//             entityId: submission.campaignId,
//           });

//           io.to(clients.get(admin.adminId)).emit('notification', notification);
//         }

//         if (admin.admin.user.Board) {
//           const task = await getTaskId({
//             boardId: admin.admin.user.Board?.id,
//             submissionId: submission.id,
//             columnName: 'Actions Needed',
//           });

//           const doneColumn = await getColumnId({
//             userId: admin.admin.user.id,
//             boardId: admin.admin.user.Board.id,
//             columnName: 'Done',
//           });

//           if (task) {
//             await prisma.task.update({
//               where: {
//                 id: task.id,
//               },
//               data: {
//                 column: { connect: { id: doneColumn } },
//               },
//             });
//           }
//         }
//       }

//       const Invoicenotification = await saveNotification({
//         userId: submission.userId,
//         title,
//         message,
//         invoiceId: invoice?.id,
//         entity: 'Invoice',
//         entityId: submission.campaignId,
//       });

//       io.to(clients.get(submission.userId)).emit('notification', Invoicenotification);

//       const images: any = submission?.campaign?.campaignBrief?.images;

//       //Email
//       creatorInvoice(submission.user.email, submission.campaign.name, submission.user.name ?? 'Creator', images[0]);

//       return res.status(200).json({ message: 'Successfully submitted' });
//     }

//     await prisma.submission.update({
//       where: {
//         id: submission.id,
//       },
//       data: {
//         status: 'REJECTED',
//         isReview: true,
//         feedback: {
//           create: {
//             content: req.body.feedback,
//             type: 'REASON',
//             adminId: userId as string,
//           },
//         },
//       },
//     });

//     // Move creator task from column In Review to In Progress
//     if (submission.user.Board) {
//       const taskInReview = await getTaskId({
//         boardId: submission.user.Board.id,
//         submissionId: submission.id,
//         columnName: 'In Review',
//       });

// const inProgressColumn: any = await getColumnId({
//   userId: submission.userId,
//   boardId: submission.user.Board.id,
//   columnName: 'In Progress',
// });

//       if (taskInReview) {
//         await updateTask({ taskId: taskInReview?.id, toColumnId: inProgressColumn, userId: submission.userId });
//       }
//     }

// for (const item of submission.campaign.campaignAdmin) {
//   if (item.admin.user.Board) {
//     const taskInActionsNeeded = await getTaskId({
//       boardId: item.admin.user.Board.id,
//       columnName: 'Actions Needed',
//       submissionId: submission.id,
//     });

//     if (taskInActionsNeeded) {
//       await prisma.task.delete({
//         where: {
//           id: taskInActionsNeeded.id,
//         },
//       });
//     }
//   }
// }

// const notification = await saveNotification({
//   userId: submission.userId,
//   message: `❌ Your posting has been rejected for campaign ${submission.campaign.name}. Feedback is provided.`,
//   entity: Entity.Post,
// });

// io.to(clients.get(submission.userId)).emit('notification', notification);
// io.to(clients.get(submission.userId)).emit('newFeedback');

//     return res.status(200).json({ message: 'Successfully submitted' });
//   } catch (error) {
//     return res.status(400).json(error);
//   }
// };

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
          data: { status: status as SubmissionStatus, isReview: true },
        });


        await deductCredits(approvedSubmission.campaignId, approvedSubmission.userId, tx as PrismaClient);

        if (taskInReview && doneColumnId) {
          await tx.task.update({
            where: { id: taskInReview.id },
            data: { columnId: doneColumnId },
          });
        }

        const invoiceAmount = submission.user.creatorAgreement.find(
          (elem) => elem.campaignId === submission.campaign.id,
        )?.amount;

        const invoice = await createInvoiceService(submission, userId, invoiceAmount);

        const shortlistedCreator = await tx.shortListedCreator.findFirst({
          where: { userId: submission.userId, campaignId: submission.campaignId },
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

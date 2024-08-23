import { Entity, PrismaClient, User } from '@prisma/client';
import { Request, Response } from 'express';
import amqplib from 'amqplib';
import { Title, saveNotification } from './notificationController';
import { clients, io } from 'src/server';

const prisma = new PrismaClient();

export const submitFirstDraft = async (req: Request, res: Response) => {
  //   Get creator Id
  const userid = req.session.userid;
  const data = JSON.parse(req.body.data);
  const { caption, campaignId, taskId } = data;

  // try {
  //   const campaign = await prisma.campaign.findUnique({
  //     where: {
  //       id: campaignId,
  //     },
  //   });
  //   const user = await prisma.user.findUnique({
  //     where: {
  //       id: userid,
  //     },
  //     include: {
  //       creator: true,
  //     },
  //   });
  //   if (!user?.creator) {
  //     return res.status(404).json({ message: 'Only creator is allow to submit a pitch' });
  //   }
  //   if (req.files && req.files.firstDraftVideo) {
  //     const conn = await amqplib.connect(`${process.env.RABBIT_MQ}`);
  //     const channel = conn.createChannel();
  //     (await channel).assertQueue('uploadFirstDraft');

  //     const firstDraft = await prisma.submission.create({
  //       data: {
  //         creatorId: user?.id as string,
  //         campaignId: campaign?.id as string,
  //         type: 'FIRST_DRAFT',
  //         campaignTaskId: taskId as string,
  //         firstDraft: {
  //           create: {
  //             draftURL: '',
  //             caption: caption,
  //             status: 'Pending',
  //           },
  //         },
  //       },
  //       include: {
  //         firstDraft: true,
  //       },
  //     });

  //     // const firstDraft = await prisma.firstDraft.create({
  //     //   data: {
  //     //     creatorId: user.id,
  //     //     campaignId: campaignId,
  //     //     status: 'Pending',
  //     //     caption: caption,
  //     //     draftURL: '',
  //     //     submission: {},
  //     //   },
  //     // });
  //     (await channel).sendToQueue(
  //       'uploadFirstDraft',
  //       Buffer.from(JSON.stringify({ draftId: firstDraft.id, video: req.files.firstDraftVideo, taskId })),
  //     );
  //   }
  //   return res.status(200).json({ message: 'Successfully submitted' });
  // } catch (error) {
  //   console.log(error);
  //   return res.status(400).json(error);
  // }
};

export const submitFinalDraft = async (req: Request, res: Response) => {
  //   Get creator Id
  const userid = req.session.userid;
  const data = JSON.parse(req.body.data);
  const { caption, campaignId, taskId } = data;

  // try {
  //   const campaign = await prisma.campaign.findUnique({
  //     where: {
  //       id: campaignId,
  //     },
  //   });
  //   const user = await prisma.user.findUnique({
  //     where: {
  //       id: userid,
  //     },
  //     include: {
  //       creator: true,
  //     },
  //   });
  //   if (!user?.creator) {
  //     return res.status(404).json({ message: 'Only creator is allow to submit a pitch' });
  //   }
  //   if (req.files && req.files.finalDraftVideo) {
  //     const conn = await amqplib.connect(`${process.env.RABBIT_MQ}`);
  //     const channel = conn.createChannel();
  //     (await channel).assertQueue('uploadFinalDraft');

  //     const finalDraft = await prisma.submission.create({
  //       data: {
  //         creatorId: user?.id as string,
  //         campaignId: campaign?.id as string,
  //         type: 'FINAL_DRAFT',
  //         campaignTaskId: taskId as string,
  //         finalDraft: {
  //           create: {
  //             draftURL: '',
  //             caption: caption,
  //             status: 'Pending',
  //           },
  //         },
  //       },
  //       include: {
  //         finalDraft: true,
  //       },
  //     });

  //     (await channel).sendToQueue(
  //       'uploadFinalDraft',
  //       Buffer.from(JSON.stringify({ draftId: finalDraft.id, video: req.files.finalDraftVideo, taskId })),
  //     );
  //   }
  //   return res.status(200).json({ message: 'Successfully submitted' });
  // } catch (error) {
  //   console.log(error);
  //   return res.status(400).json(error);
  // }
};

export const getFirstDraft = async (req: Request, res: Response) => {
  const { id } = req.params;
  // try {
  //   const firstDraft = await prisma.firstDraft.findFirst({
  //     where: {
  //       creatorId: req.session.userid,
  //       campaignId: id,
  //     },
  //   });
  //   return res.status(200).json(firstDraft);
  // } catch (error) {
  //   return res.status(400).json(error);
  // }
};

export const getAllDraftInfo = async (req: Request, res: Response) => {
  const { campaignId } = req.params;
  try {
    const shortlistedCreators = await prisma.shortListedCreator.findMany({
      where: {
        campaignId: campaignId,
      },
      include: {
        user: true,
      },
    });

    // const creators = await Promise.all(
    //   shortlistedCreators.map(async (item) => {
    //     return await prisma.user.findUnique({
    //       where: {
    //         id: item.creator.id, // Assuming `creatorId` is the correct field in `shortListedCreator`
    //       },
    //       include: {
    //         firstDraft: {
    //           where: {
    //             AND: [{ creatorId: item.creator.id }, { campaignId: campaignId }],
    //           },
    //         },
    //         finalDraft: {
    //           where: {
    //             AND: [{ creatorId: item.creator.id }, { campaignId: campaignId }],
    //           },
    //         },
    //       },
    //     });
    //   }),
    // );

    // return res.status(200).json(creators);
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const submitFeedBackFirstDraft = async (req: Request, res: Response) => {
  const { campaignTaskId, type, creatorId } = req.body;
  // try {
  //   if (type === 'request') {
  //     const { reasons, finalDraftId } = req.body;
  //     const campaignTask = await prisma.campaignTask.update({
  //       where: {
  //         id: campaignTaskId,
  //       },
  //       data: {
  //         status: 'CHANGES_REQUIRED',
  //         submission: {
  //           update: {
  //             feedback: {
  //               create: {
  //                 content: reasons,
  //                 type: 'REASON',
  //                 adminId: req.session.userid as string,
  //               },
  //             },
  //           },
  //         },
  //       },
  //       include: {
  //         campaign: true,
  //       },
  //     });

  //     await prisma.campaignTask.update({
  //       where: {
  //         id: finalDraftId,
  //       },
  //       data: {
  //         status: 'IN_PROGRESS',
  //       },
  //     });

  //     const data = await saveNotification(
  //       creatorId,
  //       Title.Create,
  //       `Request Edit For First Draft In Campaign ${campaignTask?.campaign?.name}`,
  //       Entity.User,
  //     );
  //     io.to(clients.get(creatorId)).emit('notification', data);
  //     return res.status(200).json({ message: 'Succesfully Submitted' });
  //   } else {
  //     const { comments } = req.body;
  //     const campaignTask = await prisma.campaignTask.update({
  //       where: {
  //         id: campaignTaskId,
  //       },
  //       data: {
  //         status: 'COMPLETED',
  //         submission: {
  //           update: {
  //             feedback: {
  //               create: {
  //                 content: comments,
  //                 type: 'COMMENT',
  //                 adminId: req.session.userid as string,
  //               },
  //             },
  //           },
  //         },
  //       },
  //     });
  //   }
  // } catch (error) {
  //   console.log(error);
  //   return res.status(400).json(error);
  // }
};

import { PrismaClient, User } from '@prisma/client';
import { Request, Response } from 'express';
import amqplib from 'amqplib';

const prisma = new PrismaClient();

export const submitFirstDraft = async (req: Request, res: Response) => {
  //   Get creator Id
  const userid = req.session.userid;
  const data = JSON.parse(req.body.data);
  const { caption, campaignId, taskId } = data;

  try {
    const user = await prisma.user.findUnique({
      where: {
        id: userid,
      },
      include: {
        creator: true,
      },
    });
    if (!user?.creator) {
      return res.status(404).json({ message: 'Only creator is allow to submit a pitch' });
    }
    if (req.files && req.files.firstDraftVideo) {
      const conn = await amqplib.connect('amqp://host.docker.internal');
      const channel = conn.createChannel();
      (await channel).assertQueue('uploadFirstDraft');

      const firstDraft = await prisma.firstDraft.create({
        data: {
          creatorId: user.id,
          campaignId: campaignId,
          status: 'Pending',
          caption: caption,
          draftURL: '',
        },
      });

      (await channel).sendToQueue(
        'uploadFirstDraft',
        Buffer.from(JSON.stringify({ draftId: firstDraft.id, video: req.files.firstDraftVideo, taskId })),
      );
    }
    return res.status(200).json({ message: 'Successfully submitted' });
  } catch (error) {
    console.log(error);
    return res.status(400).json(error);
  }
};

export const getFirstDraft = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const firstDraft = await prisma.firstDraft.findFirst({
      where: {
        creatorId: req.session.userid,
        campaignId: id,
      },
    });
    return res.status(200).json(firstDraft);
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const getAllDraftInfo = async (req: Request, res: Response) => {
  const { campaignId } = req.params;
  try {
    const shortlistedCreators = await prisma.shortListedCreator.findMany({
      where: {
        campaignId: campaignId,
      },
      include: {
        creator: true,
      },
    });

    const creators = await Promise.all(
      shortlistedCreators.map(async (item) => {
        return await prisma.user.findUnique({
          where: {
            id: item.creator.id, // Assuming `creatorId` is the correct field in `shortListedCreator`
          },
          include: {
            firstDraft: {
              where: {
                AND: [{ creatorId: item.creator.id }, { campaignId: campaignId }],
              },
            },
            finalDraft: {
              where: {
                AND: [{ creatorId: item.creator.id }, { campaignId: campaignId }],
              },
            },
          },
        });
      }),
    );

    return res.status(200).json(creators);
  } catch (error) {
    return res.status(400).json(error);
  }
};

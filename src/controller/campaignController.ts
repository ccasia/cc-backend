import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const updateDefaultTimeline = async (req: Request, res: Response) => {
  const {
    id,
    openForPitch,
    shortlistCreator,
    firstDraft,
    finalDraft,
    feedBackFirstDraft,
    feedBackFinalDraft,
    filterPitch,
    agreementSign,
    qc,
  } = req.body;

  try {
    const newDefaultTimeline = await prisma.defaultTimelineCampaign.update({
      where: {
        id: id,
      },
      data: {
        openForPitch,
        shortlistCreator,
        firstDraft,
        finalDraft,
        feedBackFirstDraft,
        feedBackFinalDraft,
        filterPitch,
        agreementSign,
        qc,
      },
    });

    return res.status(200).json({ message: 'Successfully updated default timeline', newDefaultTimeline });
  } catch (error) {
    return res.status(400).json(error);
  }
};

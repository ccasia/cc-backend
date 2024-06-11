import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const updateDefaultTimeline = async (req: Request, res: Response) => {
  const {
    id = '1',
    openForPitch,
    shortlistCreator,
    firstDraft,
    finalDraft,
    feedBackFirstDraft,
    feedBackFinalDraft,
    filterPitch,
    agreementSign,
    qc,
    posting,
  } = req.body;

  console.log(req.body);

  try {
    const newDefaultTimeline = await prisma.defaultTimelineCampaign.upsert({
      where: {
        id: id,
      },
      update: {
        openForPitch,
        shortlistCreator,
        firstDraft,
        finalDraft,
        feedBackFirstDraft,
        feedBackFinalDraft,
        filterPitch,
        agreementSign,
        qc,
        posting,
      },
      create: {
        openForPitch,
        shortlistCreator,
        firstDraft,
        finalDraft,
        feedBackFirstDraft,
        feedBackFinalDraft,
        filterPitch,
        agreementSign,
        qc,
        posting,
      },
    });

    return res.status(200).json({ message: 'Successfully updated default timeline', newDefaultTimeline });
  } catch (error) {
    console.log(error);
    return res.status(400).json(error);
  }
};

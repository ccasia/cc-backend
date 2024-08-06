import { Request, Response } from 'express';
import { Entity, PrismaClient } from '@prisma/client';
import { uploadAgreementForm } from 'src/config/cloudStorage.config';
import { Title, saveNotification } from './notificationController';
import { clients, io } from 'src/server';

const prisma = new PrismaClient();

export const getCreators = async (_req: Request, res: Response) => {
  try {
    const creators = await prisma.user.findMany({
      where: {
        role: 'creator',
      },
      select: {
        id: true,
        name: true,
        phoneNumber: true,
        photoURL: true,
        country: true,
        status: true,
        email: true,
        role: true,
        creator: true,
      },
    });
    res.status(200).json(creators);
  } catch (error) {
    res.status(500).json({ message: error });
  }
};

export const getCreatorByID = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const creator = await prisma.user.findFirst({
      where: {
        creator: {
          id: id,
        },
      },
      include: {
        creator: true,
      },
    });
    return res.status(200).json(creator);
  } catch (error) {
    return res.status(400).json({ error });
  }
};

export const deleteCreator = async (req: Request, res: Response) => {
  const { id } = req.params;
  console.log(id);
  try {
    const deleteCreator = await prisma.$transaction([
      prisma.industry.deleteMany({
        where: {
          userId: id,
        },
      }),
      prisma.interest.deleteMany({
        where: {
          userId: id,
        },
      }),

      prisma.creator.delete({
        where: {
          userId: id,
        },
      }),

      prisma.user.delete({
        where: {
          id: id,
        },
      }),
    ]);
    console.log(deleteCreator);
    res.status(200).json('Creator deleted successfully');
  } catch (error) {
    res.status(500).json({ message: error });
  }
};

export const updateCreator = async (req: Request, res: Response) => {
  const data = req.body;
  try {
    await prisma.creator.update({
      where: {
        userId: data.id,
      },
      data: {
        user: {
          update: {
            name: data.name,
            status: data.status,
            country: data.country,
          },
        },
      },
    });
    return res.status(200).json({ message: 'Successfully updated' });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const updateMediaKit = async (req: Request, res: Response) => {
  const { name, about, interests, creatorId } = req.body;

  try {
    const creator = await prisma.creator.findUnique({
      where: { id: creatorId },
      include: { interests: true },
    });

    if (!creator) {
      return res.status(404).json({ message: 'Creator not found' });
    }

    const creatorInterests = creator.interests.map((interest: any) => interest.name);

    const unmatchedInterests = creatorInterests.filter((interest: string) => !interests.includes(interest));

    await prisma.interest.deleteMany({
      where: {
        name: { in: unmatchedInterests },
        userId: creator.userId,
      },
    });

    const newInterests = interests.filter((interest: string) => !creatorInterests.includes(interest));

    const addedInterst = await prisma.interest.createMany({
      data: newInterests.map((interest: string) => ({
        name: interest,
        rank: 5,
        userId: creator.userId,
      })),
    });

    const mediaKit = await prisma.mediaKit.upsert({
      where: {
        creatorId: creatorId,
      },
      update: {
        name: name,
        about: about,
        interests: interests,
      },
      create: {
        name: name,
        about: about,
        interests: interests,
        creatorId: creatorId as string,
      },
    });
    return res.status(200).json({ message: 'Successfully updated', mediaKit });
  } catch (error) {
    console.log(error);
    return res.status(400).json(error);
  }
};

export const getMediaKit = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const mediaKit = await prisma.mediaKit.findUnique({
      where: {
        creatorId: id as string,
      },
    });
    return res.status(200).json(mediaKit);
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const getCreatorFullInfoById = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const user = await prisma.user.findUnique({
      where: {
        id: id,
      },
      include: {
        creator: true,
        shortlistCreator: true,
        campaignAgreement: true,

        // firstDraft: true,
        campaignTasks: true,
      },
    });

    return res.status(200).json({ user });
  } catch (error) {
    return res.status(400).json(error);
  }
};

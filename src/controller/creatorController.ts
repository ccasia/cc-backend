import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

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
        firstName: data.name.split()[0],
        lastName: data.name.split()[1] || '',
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

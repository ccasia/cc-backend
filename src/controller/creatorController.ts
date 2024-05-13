import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

export const getCreators = async (req: Request, res: Response) => {
  console.log(req.body);
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

import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const getAllSubscriptions = async (req: Request, res: Response) => {
  try {
    const subscriptions = await prisma.subscription.findMany({
      include: {
        company: {
          include: {
            brand: true,
          },
        },
        package: {
          include: {
            prices: true,
          },
        },
      },
    });

    return res.status(200).json(subscriptions);
  } catch (error) {
    return res.status(400).json(error);
  }
};

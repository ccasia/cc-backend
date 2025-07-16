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

export const updateSubscription = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { packagePrice, creditsUsed, totalCredits, expiredAt } = req.body;

  try {
    const subscription = await prisma.subscription.findUnique({
      where: { id },
    });

    if (!subscription) {
      return res.status(404).json({ message: 'Subscription not found' });
    }

    const updatedSubscription = await prisma.subscription.update({
      where: { id },
      data: {
        packagePrice: packagePrice !== undefined ? packagePrice : subscription.packagePrice,
        creditsUsed: creditsUsed !== undefined ? creditsUsed : subscription.creditsUsed,
        totalCredits: totalCredits !== undefined ? totalCredits : subscription.totalCredits,
        expiredAt: expiredAt ? new Date(expiredAt) : subscription.expiredAt,
      },
    });

    return res.status(200).json({
      message: 'Subscription updated successfully',
      data: updatedSubscription,
    });
  } catch (error) {
    console.error('Error updating subscription:', error);
    return res.status(500).json({ message: 'Failed to update subscription', error });
  }
};

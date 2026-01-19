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

export const syncSubscriptionCredits = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const subscription = await prisma.subscription.findUnique({
      where: { id },
      include: {
        campaign: {
          select: {
            id: true,
            name: true,
            creditsUtilized: true,
            campaignCredits: true,
          },
        },
      },
    });

    if (!subscription) {
      return res.status(404).json({ message: 'Subscription not found' });
    }

    const totalCreditsUtilized = subscription.campaign.reduce(
      (sum, campaign) => sum + (campaign.creditsUtilized || 0),
      0
    );

    const updatedSubscription = await prisma.subscription.update({
      where: { id },
      data: {
        creditsUsed: totalCreditsUtilized,
      },
    });

    console.log(
      `Subscription credits synced for ${id}: ${totalCreditsUtilized} credits utilized from ${subscription.campaign.length} campaigns`
    );

    return res.status(200).json({
      message: 'Subscription credits synced successfully',
      data: {
        subscriptionId: id,
        totalCredits: updatedSubscription.totalCredits,
        creditsUsed: totalCreditsUtilized,
        remainingCredits: (updatedSubscription.totalCredits || 0) - totalCreditsUtilized,
        campaignsCount: subscription.campaign.length,
      },
    });
  } catch (error) {
    console.error('Error syncing subscription credits:', error);
    return res.status(500).json({ message: 'Failed to sync subscription credits', error });
  }
};

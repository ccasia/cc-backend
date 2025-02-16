import { PrismaClient } from '@prisma/client';
import { Request } from 'express';

const prisma = new PrismaClient();

// `req` is for the admin ID
export const logChange = async (message: string, campaignId: string, req: Request) => {
  const adminId = req.session.userid;
  if (adminId === undefined) {
    throw new Error('Admin ID is undefined');
  }

  try {
    await prisma.campaignLog.create({
      data: {
        message: message,
        campaignId: campaignId,
        adminId: adminId,
      },
    });
  } catch (error) {
    return error;
  }
};

export const deductCredits = async (campaignId: string, userId: string, tx: PrismaClient) => {
  try {
    // return await prisma.$transaction(async (tx) => {
    const campaign = await tx.campaign.findUnique({
      where: {
        id: campaignId,
      },
      include: {
        brand: {
          select: {
            company: {
              select: {
                subscriptions: {
                  where: {
                    status: 'ACTIVE',
                  },
                },
              },
            },
          },
        },
        company: {
          select: {
            id: true,
            subscriptions: {
              where: {
                status: 'ACTIVE',
              },
            },
          },
        },
      },
    });

    const user = await tx.user.findUnique({
      where: {
        id: userId,
      },
    });

    if (!campaign || !user) throw new Error('Data not found');
    if (!campaign.campaignCredits) throw new Error('Campaign credits not found');
    if (!campaign?.company?.subscriptions || !campaign.brand?.company.subscriptions)
      throw new Error('Company not linked to a package');

    const subscription = campaign.company.subscriptions[0] || campaign.brand?.company.subscriptions[0];

    const submission = await tx.submission.findMany({
      where: {
        campaignId,
        userId,
        status: 'APPROVED',
      },
      include: {
        video: true,
        submissionType: {
          select: {
            type: true,
          },
        },
      },
    });

    const filterSubmission = submission.filter((submission) => submission.video.length)[0];

    const data = await tx.campaign.update({
      where: {
        id: campaign.id,
      },
      data: {
        creditsUtilized: {
          increment: filterSubmission.video.length,
        },
        creditsPending: {
          decrement: filterSubmission.video.length,
        },
      },
    });

    if (data.creditsPending && data.creditsPending < 0) throw new Error('Exceeds campaign credits');

    await tx.subscription.update({
      where: {
        id: subscription.id,
      },
      data: {
        creditsUsed: {
          increment: filterSubmission.video.length,
        },
      },
    });
  } catch (error) {
    throw new Error(error);
  }
};

// export const

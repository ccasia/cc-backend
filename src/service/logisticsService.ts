import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const fetchAllLogisticsForCampaign = async (campaignId: string) => {
  const logistics = await prisma.logistic.findMany({
    where: {
      campaignId: campaignId,
    },
    include: {
      creator: {
        select: {
          id: true,
          name: true,
          photoURL: true,
          creator: {
            select: {
              instagramUser: {
                select: {
                  username: true,
                },
              },
            },
          },
        },
      },
      deliveryDetails: {
        include: {
          product: {
            select: {
              id: true,
              productName: true,
            },
          },
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
  });
  return logistics;
};

export const fetchAllLogisticsForCreator = async (creatorId: string) => {
  // TODO: ask about number of logistics per creator per campaign
  const logistics = await prisma.logistic.findMany({
    where: {
      creatorId: creatorId,
    },
    include: {
      campaign: {
        select: {
          id: true,
          name: true,
        },
      },
      deliveryDetails: {
        include: {
          product: {
            select: {
              id: true,
              productName: true,
            },
          },
        },
      },
      reservationDetails: {}, //TODO
      storeVisitDetails: {}, //TODO
    },
    orderBy: {
      createdAt: 'desc',
    },
  });
  return logistics;
};

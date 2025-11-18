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

export const fetchCampaignLogisticForCreator = async (creatorId: string, campaignId: string) => {
  const logistics = await prisma.logistic.findUnique({
    where: {
      creatorId_campaignId: {
        creatorId: creatorId,
        campaignId: campaignId,
      },
    },
    include: {
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
  });
  return logistics;
};

type ProductCreateData = {
  productName: string;
  campaignId: string;
  description?: string;
  sku?: string;
};

export const createProductForLogistic = async (data: ProductCreateData) => {
  const { productName, campaignId, description, sku } = data;

  const newProduct = await prisma.product.create({
    data: {
      productName,
      description,
      campaign: {
        connect: { id: campaignId },
      },
    },
  });

  return newProduct;
};

export const fetchProductsForCampaign = async (campaignId: string) => {
  const products = await prisma.product.findMany({
    where: {
      campaignId: campaignId,
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  return products;
};

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
          items: {
            include: {
              product: { select: { id: true, productName: true } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
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
          items: {
            include: {
              product: { select: { id: true, productName: true } },
            },
          },
        },
      },
      reservationDetails: {}, //TODO
      storeVisitDetails: {}, //TODO
    },
    orderBy: { createdAt: 'desc' },
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
          items: {
            include: {
              product: { select: { id: true, productName: true } },
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

type ProductInput = {
  productId: string;
  quantity: number;
};

//
type AssignmentPerCreatorInput = {
  creatorId: string;
  items: ProductInput[];
};

type BulkAssignData = {
  campaignId: string;
  createdById: string;
  assignments: AssignmentPerCreatorInput[];
};

type SingleAssignData = {
  campaignId: string;
  creatorId: string;
  createdById: string;
  items: ProductInput[];
};

type SchedulingData = {
  trackingLink: string;
  expectedDeliveryDate: string;
  address: string;
};

export const assignSingleCreator = async (data: SingleAssignData) => {
  const { campaignId, creatorId, createdById, items } = data;

  return await prisma.logistic.create({
    data: {
      type: 'PRODUCT_DELIVERY',
      status: 'SCHEDULED',
      campaignId: campaignId,
      creatorId: creatorId,
      createdById: createdById,
      deliveryDetails: {
        create: {
          items: {
            create: items.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
            })),
          },
        },
      },
    },
    include: {
      deliveryDetails: { include: { items: true } },
    },
  });
};

export const assignBulkCreators = async (data: BulkAssignData) => {
  const { campaignId, createdById, assignments } = data;

  const operations = assignments.map((assignment) => {
    return prisma.logistic.create({
      data: {
        type: 'PRODUCT_DELIVERY',
        status: 'SCHEDULED',
        campaignId: campaignId,
        creatorId: assignment.creatorId,
        createdById: createdById,
        deliveryDetails: {
          create: {
            items: {
              create: assignment.items.map((item) => ({
                productId: item.productId,
                quantity: item.quantity,
              })),
            },
          },
        },
      },
      include: {
        deliveryDetails: {
          include: { items: true },
        },
      },
    });
  });

  return await prisma.$transaction(operations);
};

export const scheduleDeliveryService = async (logisticId: string, data: SchedulingData) => {
  const { trackingLink, expectedDeliveryDate, address } = data;

  return await prisma.logistic.update({
    where: { id: logisticId },
    data: {
      status: 'SHIPPED',
      shippedAt: new Date(),
      deliveryDetails: {
        update: {
          trackingLink,
          address,
          expectedDeliveryDate: expectedDeliveryDate ? new Date(expectedDeliveryDate) : undefined,
        },
      },
    },
    include: {
      deliveryDetails: {
        include: { items: true },
      },
    },
  });
};

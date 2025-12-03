import { PrismaClient, LogisticStatus } from '@prisma/client';

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
          phoneNumber: true,
          creator: {
            select: {
              instagramUser: {
                select: {
                  username: true,
                },
              },
              tiktokUser: {
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

export const deleteProductService = async (productId: string) => {
  const product = await prisma.product.findUnique({
    where: { id: productId },
  });

  if (!product) {
    throw new Error('Product not found');
  }

  return await prisma.product.delete({
    where: { id: productId },
  });
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

  const existingLogistic = await prisma.logistic.findUnique({
    where: {
      creatorId_campaignId: {
        creatorId: creatorId,
        campaignId: campaignId,
      },
    },
    include: {
      deliveryDetails: true,
    },
  });

  if (existingLogistic) {
    if (['SHIPPED', 'DELIVERED', 'RECEIVED', 'COMPLETED'].includes(existingLogistic.status)) {
      throw new Error(`Cannot assign items: Order is already ${existingLogistic.status}`);
    }

    let deliveryDetailsId = existingLogistic.deliveryDetails?.id;

    if (!deliveryDetailsId) {
      const newDetails = await prisma.deliveryDetails.create({
        data: {
          logistic: { connect: { id: existingLogistic.id } },
        },
      });
      deliveryDetailsId = newDetails.id;
    }

    await prisma.$transaction(async (tx) => {
      const incomingProductIds = items.map((i) => i.productId);

      await tx.deliveryItem.deleteMany({
        where: {
          deliveryDetailsId: deliveryDetailsId,
          productId: {
            notIn: incomingProductIds,
          },
        },
      });

      for (const item of items) {
        await tx.deliveryItem.upsert({
          where: {
            deliveryDetailsId_productId: {
              deliveryDetailsId: deliveryDetailsId!,
              productId: item.productId,
            },
          },
          // If item exists, update quantity
          update: {
            quantity: item.quantity,
          },
          // If item doesn't exist, create it
          create: {
            deliveryDetailsId: deliveryDetailsId!,
            productId: item.productId,
            quantity: item.quantity,
          },
        });
      }

      if (existingLogistic.status === 'PENDING_ASSIGNMENT') {
        await tx.logistic.update({
          where: { id: existingLogistic.id },
          data: { status: 'SCHEDULED' },
        });
      }
    });
    // Return the updated full object
    return await prisma.logistic.findUnique({
      where: { id: existingLogistic.id },
      include: { deliveryDetails: { include: { items: true } } },
    });
  }
};

export const assignBulkCreators = async (data: BulkAssignData) => {
  const { campaignId, createdById, assignments } = data;

  return await prisma.$transaction(async (tx) => {
    const results = [];

    for (const assignment of assignments) {
      const existingLogistic = await tx.logistic.findUnique({
        where: {
          creatorId_campaignId: {
            creatorId: assignment.creatorId,
            campaignId: campaignId,
          },
        },
        include: { deliveryDetails: true },
      });

      if (existingLogistic) {
        if (['SHIPPED', 'DELIVERED', 'RECEIVED', 'COMPLETED'].includes(existingLogistic.status)) {
          throw new Error(
            `Cannot assign items to Creator ${assignment.creatorId}: Order is already ${existingLogistic.status}`,
          );
        }

        let deliveryDetailsId = existingLogistic.deliveryDetails?.id;

        if (!deliveryDetailsId) {
          const newDetails = await tx.deliveryDetails.create({
            data: {
              logistic: { connect: { id: existingLogistic.id } },
            },
          });
          deliveryDetailsId = newDetails.id;
        }

        const incomingProductIds = assignment.items.map((item) => item.productId);

        await tx.deliveryItem.deleteMany({
          where: {
            deliveryDetailsId: deliveryDetailsId,
            productId: {
              notIn: incomingProductIds,
            },
          },
        });

        for (const item of assignment.items) {
          await tx.deliveryItem.upsert({
            where: {
              deliveryDetailsId_productId: {
                deliveryDetailsId: deliveryDetailsId!,
                productId: item.productId,
              },
            },
            update: {
              quantity: item.quantity,
            },
            create: {
              deliveryDetailsId: deliveryDetailsId!,
              productId: item.productId,
              quantity: item.quantity,
            },
          });
        }

        if (existingLogistic.status === 'PENDING_ASSIGNMENT') {
          await tx.logistic.update({
            where: { id: existingLogistic.id },
            data: { status: 'SCHEDULED' },
          });
        }
        results.push(existingLogistic.id);
      } else {
        const newLogistic = await tx.logistic.create({
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
        });
        results.push(newLogistic.id);
      }
    }

    return results;
  });
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

type CreatorDetailsData = {
  address: string;
  phoneNumber: string;
  dietaryRestrictions?: string;
};

export const creatorDeliveryDetails = async (logisticId: string, data: CreatorDetailsData) => {
  const { address, phoneNumber, dietaryRestrictions } = data;

  return await prisma.logistic.update({
    where: { id: logisticId },
    data: {
      creator: {
        update: {
          phoneNumber: phoneNumber,
        },
      },
      deliveryDetails: {
        update: {
          address,
          dietaryRestrictions,
        },
      },
    },
    include: {
      deliveryDetails: { include: { items: { include: { product: true } } } },
      creator: true,
    },
  });
};

export const updateDeliveryStatus = async (logisticId: string, status: 'RECEIVED' | 'COMPLETED') => {
  return await prisma.logistic.update({
    where: { id: logisticId },
    data: {
      status,
      receivedAt: new Date(),
      completedAt: status === 'COMPLETED' ? new Date() : undefined,
    },
  });
};

export const reportLogisticIssue = async (logisticId: string, reason: string, reportedById: string) => {
  return await prisma.$transaction(async (tx) => {
    await tx.logisticIssue.create({
      data: {
        logisticId,
        reason,
        reportedById,
        status: 'OPEN',
      },
    });

    return await tx.logistic.update({
      where: { id: logisticId },
      data: {
        status: 'ISSUE_REPORTED',
      },
    });
  });
};

export const updateStatusService = async (logisticId: string, status: LogisticStatus) => {
  const data: any = { status };

  const now = new Date();
  if (status === 'SHIPPED') data.shippedAt = now;
  if (status === 'DELIVERED') data.deliveredAt = now;
  if (status === 'RECEIVED') data.receivededAt = now;
  if (status === 'COMPLETED') data.completedAt = now;

  return await prisma.logistic.update({
    where: { id: logisticId },
    data: data,
  });
};

type AdminUpdateData = {
  items?: ProductInput[];
  address?: string;
  phoneNumber?: string;
  trackingLink?: string;
  expectedDeliveryDate?: string | Date;
  dietaryRestrictions?: string;
};

export const adminUpdateService = async (logisticId: string, data: AdminUpdateData) => {
  const { items, address, phoneNumber, trackingLink, expectedDeliveryDate, dietaryRestrictions } = data;

  return await prisma.$transaction(async (tx) => {
    const logistic = await tx.logistic.findUnique({
      where: { id: logisticId },
      include: { deliveryDetails: true },
    });

    if (!logistic) throw new Error('Logistic not found');

    let deliveryDetailsId = logistic.deliveryDetails?.id;

    if (!deliveryDetailsId) {
      const newDetails = await tx.deliveryDetails.create({ data: { logistic: { connect: { id: logisticId } } } });
      deliveryDetailsId = newDetails.id;
    }

    await tx.logistic.update({
      where: { id: logisticId },
      data: {
        creator: phoneNumber
          ? {
              update: { phoneNumber },
            }
          : undefined,
        deliveryDetails: {
          update: {
            address,
            trackingLink,
            dietaryRestrictions,
            expectedDeliveryDate: expectedDeliveryDate ? new Date(expectedDeliveryDate) : undefined,
          },
        },
      },
    });

    if (items && Array.isArray(items)) {
      const inputProductIds = items.map((i) => i.productId);

      await tx.deliveryItem.deleteMany({
        where: {
          deliveryDetailsId: deliveryDetailsId,
          productId: { notIn: inputProductIds },
        },
      });

      for (const item of items) {
        if (item.quantity <= 0) continue;

        await tx.deliveryItem.upsert({
          where: {
            deliveryDetailsId_productId: {
              deliveryDetailsId: deliveryDetailsId!,
              productId: item.productId,
            },
          },
          update: {
            quantity: item.quantity,
          },
          create: {
            deliveryDetailsId: deliveryDetailsId!,
            productId: item.productId,
            quantity: item.quantity,
          },
        });
      }
    }

    return await tx.logistic.findUnique({
      where: { id: logisticId },
      include: {
        creator: true,
        deliveryDetails: {
          include: {
            items: { include: { product: true } },
          },
        },
      },
    });
  });
};

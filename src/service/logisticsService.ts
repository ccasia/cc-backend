import { PrismaClient, LogisticStatus } from '@prisma/client';
import { addMinutes, format, isSameDay, addDays, startOfDay, isBefore, isAfter, getDay } from 'date-fns';
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
      issues: true,
      deliveryDetails: {
        include: {
          items: {
            include: {
              product: { select: { id: true, productName: true } },
            },
          },
        },
      },
      reservationDetails: {
        include: {
          slots: {
            orderBy: { startTime: 'asc' },
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
      campaign: {
        select: {
          id: true,
          name: true,
          reservationConfig: true,
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
      reservationDetails: {
        include: {
          slots: {
            orderBy: { startTime: 'asc' },
          },
        },
      },
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
      reservationDetails: {
        include: {
          slots: {
            orderBy: { startTime: 'asc' },
          },
        },
      },
    },
  });
  return logistics;
};

interface ProductCreateData {
  productName: string;
  campaignId: string;
  description?: string;
  sku?: string;
}

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

interface ProductInput {
  productId: string;
  quantity: number;
}

//
interface AssignmentPerCreatorInput {
  creatorId: string;
  items: ProductInput[];
}

interface BulkAssignData {
  campaignId: string;
  createdById: string;
  assignments: AssignmentPerCreatorInput[];
}

interface SingleAssignData {
  campaignId: string;
  creatorId: string;
  createdById: string;
  items: ProductInput[];
}

interface SchedulingData {
  trackingLink: string;
  expectedDeliveryDate: string;
  address: string;
}

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

interface CreatorDetailsData {
  address: string;
  phoneNumber: string;
  dietaryRestrictions?: string;
}

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
          isConfirmed: true,
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
  return await prisma.$transaction(async (tx) => {
    const currentLogistic = await tx.logistic.findUnique({
      where: { id: logisticId },
      include: {
        deliveryDetails: true,
        reservationDetails: true,
      },
    });

    if (!currentLogistic) throw new Error('Logistic not found');

    const data: any = { status };
    const now = new Date();

    if (status === 'COMPLETED') data.completedAt = now;

    if (currentLogistic.type === 'PRODUCT_DELIVERY') {
      if (status === 'SHIPPED') data.shippedAt = now;
      if (status === 'DELIVERED') data.deliveredAt = now;
      if (status === 'RECEIVED') data.receivedAt = now;

      if (status === 'PENDING_ASSIGNMENT') {
        if (currentLogistic.deliveryDetails?.id) {
          await tx.deliveryItem.deleteMany({
            where: {
              deliveryDetailsId: currentLogistic.deliveryDetails.id,
            },
          });
        }

        data.deliveryDetails = {
          update: {
            trackingLink: null,
            expectedDeliveryDate: null,
          },
        };

        data.shippedAt = null;
        data.deliveredAt = null;
        data.receivedAt = null;
        data.completedAt = null;
      }
    }

    if (currentLogistic.type === 'RESERVATION') {

      if (status === 'PENDING_ASSIGNMENT') {
        if (currentLogistic.reservationDetails?.id) {
          await tx.reservationSlot.deleteMany({
            where: {
              reservationDetailsId: currentLogistic.reservationDetails.id,
            },
          });
        }

        data.reservationDetails = {
          update: {
            isConfirmed: false,
          },
        };

        // Clear timestamps
        data.completedAt = null;
      }
    }

    return await prisma.logistic.update({
      where: { id: logisticId },
      data: data,
    });
  });
};

interface AdminUpdateData {
  items?: ProductInput[];
  address?: string;
  phoneNumber?: string;
  trackingLink?: string;
  expectedDeliveryDate?: string | Date;
  dietaryRestrictions?: string;
}

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
        status: 'SCHEDULED',
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
        issues: true,
        deliveryDetails: {
          include: {
            items: { include: { product: true } },
          },
        },
      },
    });
  });
};

export const resolveIssueService = async (logisticId: string, resolvedBy: string) => {
  return await prisma.$transaction(async (tx) => {
    await tx.logisticIssue.updateMany({
      where: {
        logisticId,
        status: 'OPEN',
      },
      data: {
        status: 'RESOLVED',
        resolvedAt: new Date(),
        resolutionNotes: 'Marked as Resolved',
      },
    });

    return await tx.logistic.update({
      where: { id: logisticId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    });
  });
};

export const retryDeliveryService = async (logisticId: string, resolvedBy: string) => {
  return await prisma.$transaction(async (tx) => {
    await tx.logisticIssue.updateMany({
      where: {
        logisticId,
        status: 'OPEN',
      },
      data: {
        status: 'RESOLVED',
        resolvedAt: new Date(),
        resolutionNotes: 'Retry requested by Client/Admin',
      },
    });

    return await tx.logistic.update({
      where: { id: logisticId },
      data: {
        status: 'SCHEDULED',
        shippedAt: null,
        deliveredAt: null,
      },
    });
  });
};

type LogisticsInfoInput = {
  userId: string;
  campaignId: string;
  dietaryRestrictions?: string;
  userData: {
    address: string;
    location?: string;
    city: string;
    state: string;
    country: string;
    postcode: string;
  };
};

export const creatorProductInfoService = async ({
  userId,
  campaignId,
  userData,
  dietaryRestrictions,
}: LogisticsInfoInput) => {
  return await prisma.$transaction(async (tx) => {
    const creator = await tx.creator.findUnique({
      where: {
        userId: userId,
      },
    });

    if (!creator) {
      throw new Error('Creator not found');
    }

    await tx.creator.update({
      where: {
        userId: userId,
      },
      data: {
        address: userData.address,
        location: userData.location,
        city: userData.city,
        state: userData.state,
        country: userData.country,
        postcode: userData.postcode,
        dietaryRestrictions: dietaryRestrictions,
      },
    });

    const logistic = await tx.logistic.findUnique({
      where: {
        creatorId_campaignId: {
          creatorId: userId,
          campaignId: campaignId,
        },
      },
    });

    const fullAddressString = [
      userData.location,
      userData.address,
      userData.city,
      userData.postcode,
      userData.state,
      userData.country,
    ]
      .filter(Boolean)
      .join(', ');

    if (logistic) {
      return await tx.logistic.update({
        where: { id: logistic.id },
        data: {
          deliveryDetails: {
            upsert: {
              create: {
                dietaryRestrictions,
                address: fullAddressString,
              },
              update: {
                dietaryRestrictions,
                address: fullAddressString,
              },
            },
          },
        },
      });
    } else {
      return await tx.logistic.create({
        data: {
          campaignId,
          creatorId: userId,
          createdById: userId,
          type: 'PRODUCT_DELIVERY',
          status: 'PENDING_ASSIGNMENT',
          deliveryDetails: {
            create: {
              dietaryRestrictions,
              address: fullAddressString,
            },
          },
        },
      });
    }
  });
};

// -----------------------Reservation services ----------------------------

type ReservationConfigData = {
  mode: 'MANUAL_CONFIRMATION' | 'AUTO_SCHEDULE';
  locations: string[];
  availabilityRules: {
    dates: string[];
    startTime: string;
    endTime: string;
    interval: number;
  }[];
};

export const upsertReservationConfigService = async (campaignId: string, data: ReservationConfigData) => {
  const { mode, locations, availabilityRules } = data;

  return await prisma.reservationConfiguration.upsert({
    where: {
      campaignId: campaignId,
    },
    update: {
      mode,
      locations,
      availabilityRules,
    },
    create: {
      campaign: { connect: { id: campaignId } },
      mode,
      locations,
      availabilityRules,
    },
  });
};

export const getReservationConfigService = async (campaignId: string) => {
  return await prisma.reservationConfiguration.findUnique({
    where: { campaignId },
  });
};

export const getAvailableSlotsService = async (campaignId: string, monthDate: Date) => {
  const config = await prisma.reservationConfiguration.findUnique({
    where: { campaignId },
  });

  if (!config) throw new Error('Reservation configuration not found');

  const rules = config.availabilityRules as any[];
  const startOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const endOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);

  const existingBookings = await prisma.reservationSlot.findMany({
    where: {
      reservationDetails: { logistic: { campaignId } },
      status: 'SELECTED',
      startTime: { gte: startOfMonth, lte: endOfMonth },
    },
    include: {
      reservationDetails: {
        include: {
          logistic: {
            include: {
              creator: {
                select: {
                  id: true,
                  name: true,
                  photoURL: true,
                  phoneNumber: true,
                },
              },
            },
          },
        },
      },
    },
  });

  const daysInMonth = [];
  let currentDate = startOfMonth;

  while (currentDate <= endOfMonth) {
    const dateString = format(currentDate, 'yyyy-MM-dd');
    const displayDate = format(currentDate, 'dd-MM-yyyy');
    const activeRule = rules.find((rule) => rule.dates.includes(dateString));

    if (!activeRule) {
      daysInMonth.push({ date: displayDate, available: false, slots: [] });
    } else {
      const slots = [];

      // 1. Parse "HH:mm" strings from the rule
      const [startHour, startMinute] = activeRule.startTime.split(':').map(Number);
      const [endHour, endMinute] = activeRule.endTime.split(':').map(Number);

      // 2. Set the Start Time for this specific date
      let slotTime = new Date(currentDate);
      slotTime.setHours(startHour, startMinute, 0, 0);

      // 3. Set the End Time limit for this specific date
      const endTimeObject = new Date(currentDate);
      endTimeObject.setHours(endHour, endMinute, 0, 0);

      // 4. Convert interval (hours) to minutes for calculation
      // Example: 0.5 hours -> 30 minutes
      const intervalMinutes = activeRule.interval * 60;

      // 5. Loop to generate slots
      while (slotTime < endTimeObject) {
        const slotEnd = addMinutes(slotTime, intervalMinutes);

        // Safety check: Don't generate a slot that goes past the rule's end time
        // e.g. If end time is 5:00 PM, don't create a 4:30-5:30 slot
        if (isAfter(slotEnd, endTimeObject)) break;

        // 6. Check if this specific time is already booked
        const bookingsInSlot = existingBookings.filter(
          (booking) => booking.startTime.getTime() === slotTime.getTime(), // Exact match for start time
        );

        const attendees = bookingsInSlot.map((booking) => ({
          id: booking.reservationDetails.logistic.creator.id,
          name: booking.reservationDetails.logistic.creator.name,
          photoURL: booking.reservationDetails.logistic.creator.photoURL,
          phoneNumber: booking.reservationDetails.logistic.creator.phoneNumber,
        }));

        slots.push({
          startTime: slotTime.toISOString(),
          endTime: slotEnd.toISOString(),
          isTaken: attendees.length > 0, // Keep for backward compatibility
          attendees: attendees, // NEW FIELD: Array of people booked here
        });

        slotTime = slotEnd;
      }

      daysInMonth.push({ date: dateString, available: true, slots });
    }

    currentDate = addDays(currentDate, 1);
  }

  return daysInMonth;
};

type ReservationSelectionData = {
  creatorId: string;
  outlet: string;
  contactNumber: string;
  remarks?: string;
  pax: number;
  selectedSlots: { start: string; end: string }[];
};

export const submitReservationService = async (campaignId: string, data: ReservationSelectionData) => {
  const { creatorId, outlet, contactNumber, remarks, pax, selectedSlots } = data;

  const config = await prisma.reservationConfiguration.findUnique({
    where: { campaignId },
  });

  return await prisma.$transaction(async (tx) => {
    let logistic = await tx.logistic.findUnique({
      where: { creatorId_campaignId: { creatorId, campaignId } },
    });

    if (!logistic) {
      logistic = await tx.logistic.create({
        data: {
          campaignId,
          creatorId,
          createdById: creatorId,
          type: 'RESERVATION',
          status: config?.mode === 'AUTO_SCHEDULE' ? 'SCHEDULED' : 'PENDING_ASSIGNMENT',
        },
      });
    } else {
      await tx.logistic.update({
        where: { id: logistic.id },
        data: {
          status: config?.mode === 'AUTO_SCHEDULE' ? 'SCHEDULED' : 'PENDING_ASSIGNMENT',
        },
      });
    }

    const reservationDetails = await tx.reservationDetails.upsert({
      where: { logisticId: logistic.id },
      create: {
        logisticId: logistic.id,
        outlet: outlet,
        pax: pax,
        creatorRemarks: remarks,
      },
      update: {
        outlet: outlet,
        pax: pax,
        creatorRemarks: remarks,
      },
    });

    await tx.reservationSlot.deleteMany({
      where: { reservationDetailsId: reservationDetails.id },
    });

    const initialSlotStatus = config?.mode === 'AUTO_SCHEDULE' ? 'SELECTED' : 'PROPOSED';

    await tx.reservationSlot.createMany({
      data: selectedSlots.map((slot) => ({
        reservationDetailsId: reservationDetails.id,
        startTime: new Date(slot.start),
        endTime: new Date(slot.end),
        status: initialSlotStatus,
      })),
    });

    // await tx.user.update({
    //   where: { id: creatorId },
    //   data: { phoneNumber: contactNumber },
    // });

    return logistic;
  });
};

type ConfirmReservationData = {
  slotId: string;
  picName?: string;
  picContact?: string;
  budget?: string;
  promoCode?: string;
  clientRemarks?: string;
  outlet?: string;
};

export const confirmReservationService = async (logisticId: string, data: ConfirmReservationData) => {
  const { slotId, picName, picContact, budget, promoCode, clientRemarks, outlet } = data;

  return await prisma.$transaction(async (tx) => {
    const logistic = await tx.logistic.findUnique({
      where: { id: logisticId },
      include: { reservationDetails: { include: { slots: true } } },
    });

    if (!logistic || !logistic.reservationDetails) {
      throw new Error('Logistic or Reservation Details not found');
    }

    const detailsId = logistic.reservationDetails.id;

    const updateSlot = logistic.reservationDetails.slots.map((slot) => {
      if (slot.id === slotId) {
        return tx.reservationSlot.update({
          where: { id: slot.id },
          data: { status: 'SELECTED' },
        });
      } else {
        return tx.reservationSlot.update({
          where: { id: slot.id },
          data: { status: 'REJECTED' },
        });
      }
    });
    await Promise.all(updateSlot);

    await tx.reservationDetails.update({
      where: { id: detailsId },
      data: {
        picName,
        picContact,
        budget,
        promoCode,
        clientRemarks,
        outlet: outlet || logistic.reservationDetails.outlet,
      },
    });

    return await tx.logistic.update({
      where: { id: logisticId },
      data: {
        status: 'SCHEDULED',
      },
      include: {
        reservationDetails: { include: { slots: true } },
      },
    });
  });
};

export const rescheduleReservationService = async (logisticId: string) => {
  return await prisma.$transaction(async (tx) => {
    const logistic = await tx.logistic.findUnique({
      where: { id: logisticId },
      include: { reservationDetails: true },
    });

    if (!logistic || !logistic.reservationDetails) throw new Error('Reservation not found');

    await tx.reservationSlot.deleteMany({
      where: { reservationDetailsId: logistic.reservationDetails.id },
    });

    return await tx.logistic.update({
      where: { id: logisticId },
      data: {
        status: 'PENDING_ASSIGNMENT',
        shippedAt: null, // Clear these if they were set
        deliveredAt: null,
        completedAt: null,
      },
    });
  });
};

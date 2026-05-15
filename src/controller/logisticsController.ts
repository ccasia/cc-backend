import { Request, Response } from 'express';
import {
  fetchAllLogisticsForCampaign,
  fetchAllLogisticsForCreator,
  fetchCampaignLogisticForCreator,
  fetchProductsForCampaign,
  createProductForLogistic,
  deleteProductService,
  assignBulkCreators,
  assignSingleCreator,
  scheduleDeliveryService,
  creatorDeliveryDetails,
  completeLogisticService,
  reportLogisticIssue,
  updateStatusService,
  adminUpdateService,
  resolveIssueService,
  retryDeliveryService,
  creatorProductInfoService,
  upsertReservationConfigService,
  getReservationConfigService,
  getAvailableSlotsService,
  submitReservationService,
  scheduleReservationService,
  rescheduleReservationService,
  updateReservationDetailService,
  adminScheduleService,
} from '@services/logisticsService';
import { logChange } from '@services/campaignServices';
import { computeChanges, FieldMapping } from '@utils/campaignLogDiff';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function getLogisticContext(logisticId: string) {
  const logistic = await prisma.logistic.findUnique({
    where: { id: logisticId },
    select: {
      campaignId: true,
      type: true,
      creator: { select: { name: true } },
      reservationDetails: { select: { outlet: true } },
    },
  });
  return {
    campaignId: logistic?.campaignId || '',
    creatorName: logistic?.creator?.name || 'Unknown Creator',
    type: logistic?.type || 'PRODUCT_DELIVERY',
    outlet: logistic?.reservationDetails?.outlet || null,
  };
}

export const getLogisticsForCampaign = async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;
    if (!campaignId) {
      return res.status(400).json({ message: 'Campaign ID is required.' });
    }
    const logistics = await fetchAllLogisticsForCampaign(campaignId);
    return res.status(200).json(logistics);
  } catch (error) {
    console.error('Error fetching logistics for campaign:', error);
    return res.status(500).json({ message: 'Failed to retrieve logistics details.' });
  }
};

export const getCreatorLogistics = async (req: Request, res: Response) => {
  try {
    const { userid } = (req as any).session;

    const logistics = await fetchAllLogisticsForCreator(userid);
    return res.status(200).json(logistics);
  } catch (error) {
    console.error('Error fetching creator logistics:', error);
    return res.status(500).json({ message: 'Unable to retrieve logistics for this creator.' });
  }
};

export const getCreatorLogisticForCampaign = async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;
    const { userid } = (req as any).session;

    if (!campaignId) {
      return res.status(400).json({ message: 'Campaign ID is required.' });
    }

    const logistic = await fetchCampaignLogisticForCreator(userid, campaignId);

    if (!logistic) {
      return res.status(404).json({ message: 'No logistic found for this creator in this campaign.' });
    }

    return res.status(200).json(logistic);
  } catch (error) {
    console.error('Error fetching creator logistic for campaign:', error);
    return res.status(500).json({ message: 'Unable to fetch creator logistic for this campaign' });
  }
};

export const createProduct = async (req: Request, res: Response) => {
  try {
    const { campaignId, productName } = req.body;

    if (!campaignId || !productName) {
      return res.status(400).json({ message: 'Campaign ID and Product Name are required.' });
    }

    const newProduct = await createProductForLogistic(req.body);
    return res.status(201).json(newProduct);
  } catch (error) {
    console.error('Error creating product:', error);
    return res.status(500).json({ message: 'Unable to create product' });
  }
};

export const deleteProduct = async (req: Request, res: Response) => {
  try {
    const { productId } = req.params;

    if (!productId) {
      return res.status(400).json({ message: 'Product ID is required.' });
    }

    await deleteProductService(productId);
    return res.status(200).json({ message: 'Product deleted successfully' });
  } catch (error) {
    console.error('Error deleting product:', error);
    return res.status(500).json({ message: 'Unable to delete product' });
  }
};

export const getProductsForCampaign = async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;
    const products = await fetchProductsForCampaign(campaignId);
    return res.status(200).json(products);
  } catch (error) {
    console.error('Error fetching products for campaign:', error);
    return res.status(500).json({ message: 'Unable to fetch products for this campaign' });
  }
};

export const singleAssignmentLogistics = async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;
    const { creatorId, items } = req.body;
    const { userid: createdById } = (req as any).session;

    if (!creatorId || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Creator ID and a non-empty array of items are required.' });
    }

    const logistic = await assignSingleCreator({ campaignId, creatorId, createdById, items });

    const creator = await prisma.user.findUnique({ where: { id: creatorId }, select: { name: true } });
    const products = await prisma.product.findMany({
      where: { id: { in: items.map((i: any) => i.productId) } },
      select: { id: true, productName: true },
    });
    const productMap = new Map(products.map((p) => [p.id, p.productName]));
    const assignedItems = items.map((i: any) => ({
      name: productMap.get(i.productId) || 'Unknown Product',
      quantity: i.quantity,
    }));
    await logChange(`Logistics assigned to ${creator?.name || 'Unknown Creator'}`, campaignId, req, undefined, {
      assignedItems,
    });

    return res.status(201).json(logistic);
  } catch (error) {
    console.error('Error in singleAssignmentLogistics controller', error);
    res.status(500).json({ message: 'Failed to assign logistics to the creator.' });
  }
};

export const bulkAssignmentLogistics = async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;
    const { assignments } = req.body;
    const { userid: createdById } = (req as any).session;

    if (!assignments || !Array.isArray(assignments) || assignments.length === 0) {
      return res.status(400).json({ message: 'Assignments array is required and cannot be empty.' });
    }

    const isValid = assignments.every((a) => a.creatorId && Array.isArray(a.items) && a.items.length > 0);

    if (!isValid) {
      return res
        .status(400)
        .json({ message: 'Invalid assignment structure. Each assignment needs a creatorId and an items array.' });
    }

    const logistics = await assignBulkCreators({
      campaignId,
      createdById,
      assignments,
    });

    // Resolve product names and creator names for logging
    const allProductIds = [...new Set(assignments.flatMap((a: any) => a.items.map((i: any) => i.productId)))];
    const allCreatorIds = assignments.map((a: any) => a.creatorId);
    const [products, creators] = await Promise.all([
      prisma.product.findMany({ where: { id: { in: allProductIds } }, select: { id: true, productName: true } }),
      prisma.user.findMany({ where: { id: { in: allCreatorIds } }, select: { id: true, name: true } }),
    ]);
    const productMap = new Map(products.map((p) => [p.id, p.productName]));
    const creatorMap = new Map(creators.map((c) => [c.id, c.name]));

    for (const assignment of assignments) {
      const creatorName = creatorMap.get(assignment.creatorId) || 'Unknown Creator';
      const assignedItems = assignment.items.map((i: any) => ({
        name: productMap.get(i.productId) || 'Unknown Product',
        quantity: i.quantity,
      }));
      await logChange(`Logistics assigned to ${creatorName}`, campaignId, req, undefined, { assignedItems });
    }

    return res.status(201).json(logistics);
  } catch (error) {
    console.error('Error in bulkAssignmentLogistics controller:', error);
    return res.status(500).json({ message: 'Failed to bulk assign to multiple creators' });
  }
};

export const scheduleDelivery = async (req: Request, res: Response) => {
  try {
    const { logisticId } = req.params;
    const { trackingLink, expectedDeliveryDate } = req.body;
    const logistic = await scheduleDeliveryService(logisticId, req.body);

    const { campaignId, creatorName } = await getLogisticContext(logisticId);

    // Fetch address from delivery details for metadata
    const deliveryInfo = await prisma.logistic.findUnique({
      where: { id: logisticId },
      select: { deliveryDetails: { select: { address: true } } },
    });

    await logChange(`Scheduled product delivery for ${creatorName}`, campaignId, req, undefined, {
      status: 'SHIPPED',
      trackingLink: trackingLink || null,
      expectedDeliveryDate: expectedDeliveryDate || null,
      address: deliveryInfo?.deliveryDetails?.address || null,
    });

    return res.status(200).json(logistic);
  } catch (error) {
    console.error('Error in scheduleDelivery controller:', error);
    return res.status(500).json({ message: 'Failed to schedule delivery.' });
  }
};

export const updateCreatorDeliveryDetails = async (req: Request, res: Response) => {
  try {
    const { logisticId } = req.params;
    const { address, phoneNumber, remarks } = req.body;

    const updatedDetails = await creatorDeliveryDetails(logisticId, {
      address,
      phoneNumber,
      dietaryRestrictions: remarks,
    });

    const { campaignId, creatorName } = await getLogisticContext(logisticId);
    await logChange(`${creatorName} updated delivery details`, campaignId, req, undefined, {
      address: address || null,
      phoneNumber: phoneNumber || null,
      dietaryRestrictions: remarks || null,
    });

    return res.status(200).json(updatedDetails);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Failed to update creator delivery details.' });
  }
};

export const markLogisticReceived = async (req: Request, res: Response) => {
  try {
    const { logisticId } = req.params;
    const updated = await completeLogisticService(logisticId, 'RECEIVED');

    const { campaignId, creatorName, type, outlet } = await getLogisticContext(logisticId);
    const message =
      type === 'RESERVATION' && outlet
        ? `${creatorName} checked in at ${outlet}`
        : `${creatorName} marked logistics as received`;
    const metadata = type === 'RESERVATION' && outlet ? { outlet } : undefined;
    await logChange(message, campaignId, req, undefined, metadata);

    return res.status(200).json(updated);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Failed to receive logistics.' });
  }
};

export const markLogisticCompleted = async (req: Request, res: Response) => {
  try {
    const { logisticId } = req.params;
    const updated = await completeLogisticService(logisticId, 'COMPLETED');

    const { campaignId, creatorName, type, outlet } = await getLogisticContext(logisticId);
    const message =
      type === 'RESERVATION' && outlet
        ? `${creatorName} completed their visit at ${outlet}`
        : `${creatorName} marked logistics as completed`;
    const metadata = type === 'RESERVATION' && outlet ? { outlet } : undefined;
    await logChange(message, campaignId, req, undefined, metadata);

    return res.status(200).json(updated);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Failed to complete logistics.' });
  }
};

export const reportIssue = async (req: Request, res: Response) => {
  try {
    const { logisticId } = req.params;
    const { reason } = req.body;
    const { userid } = (req as any).session;

    const updated = await reportLogisticIssue(logisticId, reason, userid);

    const { campaignId, creatorName, type, outlet } = await getLogisticContext(logisticId);

    // Fetch assigned product names for metadata
    const logisticWithItems = await prisma.logistic.findUnique({
      where: { id: logisticId },
      select: { deliveryDetails: { select: { items: { select: { product: { select: { productName: true } } } } } } },
    });
    const productNames =
      logisticWithItems?.deliveryDetails?.items?.map((i: any) => i.product?.productName).filter(Boolean) || [];

    const message =
      type === 'RESERVATION' && outlet
        ? `${creatorName} reported an issue with their reservation at ${outlet}`
        : `${creatorName} reported a logistics issue`;
    await logChange(message, campaignId, req, undefined, {
      reason: reason || null,
      products: productNames.length > 0 ? productNames : null,
      ...(type === 'RESERVATION' && outlet ? { outlet } : {}),
    });

    return res.status(200).json(updated);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Failed to report logistic issue.' });
  }
};

export const updateLogisticStatus = async (req: Request, res: Response) => {
  try {
    const { logisticId } = req.params;
    const { status } = req.body;

    if (!status) return res.status(400).json({ message: 'Status is required' });

    const updatedStatus = await updateStatusService(logisticId, status);

    const { campaignId, creatorName } = await getLogisticContext(logisticId);
    await logChange(`Logistics status for ${creatorName} changed to ${status}`, campaignId, req);

    return res.status(200).json(updatedStatus);
  } catch (error) {
    console.error('Error updating status:', error);
    return res.status(500).json({ message: 'Failed to update logistic status.' });
  }
};

export const adminUpdateLogisticDetails = async (req: Request, res: Response) => {
  try {
    const { logisticId } = req.params;

    const { items, address, phoneNumber, trackingLink, expectedDeliveryDate, dietaryRestrictions } = req.body;

    // Fetch current delivery details before update to detect date changes
    const currentLogistic = await prisma.logistic.findUnique({
      where: { id: logisticId },
      select: { deliveryDetails: { select: { expectedDeliveryDate: true } } },
    });
    const oldDate = currentLogistic?.deliveryDetails?.expectedDeliveryDate;

    const updatedLogistic = await adminUpdateService(logisticId, {
      items,
      address,
      phoneNumber,
      trackingLink,
      expectedDeliveryDate,
      dietaryRestrictions,
    });

    const { campaignId, creatorName } = await getLogisticContext(logisticId);

    // Log specific date change if expected delivery date was modified
    if (expectedDeliveryDate) {
      const newDate = new Date(expectedDeliveryDate);
      const dateChanged = !oldDate || newDate.toISOString() !== new Date(oldDate).toISOString();
      if (dateChanged) {
        const fmt = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
        const oldStr = oldDate ? fmt(new Date(oldDate)) : 'unset';
        const newStr = fmt(newDate);
        await logChange(
          `Expected delivery date for ${creatorName} changed from ${oldStr} to ${newStr}`,
          campaignId,
          req,
          undefined,
          {
            oldDate: oldStr,
            newDate: newStr,
          },
        );
      }
    }

    // If items were assigned, log a specific assignment message with product details
    if (items && Array.isArray(items) && items.length > 0) {
      const products = await prisma.product.findMany({
        where: { id: { in: items.map((i: any) => i.productId) } },
        select: { id: true, productName: true },
      });
      const productMap = new Map(products.map((p) => [p.id, p.productName]));
      const assignedItems = items.map((i: any) => ({
        name: productMap.get(i.productId) || 'Unknown Product',
        quantity: i.quantity,
      }));
      await logChange(`Logistics assigned to ${creatorName}`, campaignId, req, undefined, { assignedItems });
    } else {
      // Build metadata with only non-null fields for general detail updates
      const detailsMeta: Record<string, any> = {};
      if (trackingLink) detailsMeta.trackingLink = trackingLink;
      if (expectedDeliveryDate) detailsMeta.expectedDeliveryDate = expectedDeliveryDate;
      if (address) detailsMeta.address = address;

      await logChange(
        `Logistics details updated for ${creatorName}`,
        campaignId,
        req,
        undefined,
        Object.keys(detailsMeta).length > 0 ? detailsMeta : undefined,
      );
    }

    return res.status(200).json(updatedLogistic);
  } catch (error) {
    console.error('Error admin updating logistic:', error);
    return res.status(500).json({ message: 'Failed to update logistic.' });
  }
};

export const resolveLogisticIssue = async (req: Request, res: Response) => {
  try {
    const { logisticId } = req.params;
    const { userid } = (req as any).session;

    // Fetch issue reason before resolving (status is still OPEN)
    const openIssue = await prisma.logisticIssue.findFirst({
      where: { logisticId, status: 'OPEN' },
      select: { reason: true },
      orderBy: { createdAt: 'desc' },
    });

    const result = await resolveIssueService(logisticId, userid);

    const { campaignId, creatorName, type, outlet } = await getLogisticContext(logisticId);
    const message =
      type === 'RESERVATION' && outlet
        ? `Reservation issue resolved for ${creatorName} at ${outlet}`
        : `Logistics issue resolved for ${creatorName}`;
    const meta: Record<string, any> = {};
    if (type === 'RESERVATION' && outlet) meta.outlet = outlet;
    if (openIssue?.reason) meta.reason = openIssue.reason;
    await logChange(message, campaignId, req, undefined, Object.keys(meta).length > 0 ? meta : undefined);

    return res.status(200).json(result);
  } catch (error) {
    console.error('Error resolving issue:', error);
    res.status(500).json({ message: 'Failed to resolve issue' });
  }
};

export const retryLogisticDelivery = async (req: Request, res: Response) => {
  try {
    const { logisticId } = req.params;
    const { userid } = (req as any).session;

    const result = await retryDeliveryService(logisticId, userid);

    const { campaignId, creatorName } = await getLogisticContext(logisticId);
    await logChange(`Logistics delivery retry scheduled for ${creatorName}`, campaignId, req);

    return res.status(200).json(result);
  } catch (error) {
    console.error('Error retrying delivery:', error);
    return res.status(500).json({ message: 'Failed to retry product delivery.' });
  }
};

export const submitCreatorProductInfo = async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;
    const { userid } = (req as any).session;
    const { address, location, city, state, country, postcode, dietaryRestrictions } = req.body;

    const result = await creatorProductInfoService({
      userId: userid,
      campaignId,
      userData: { address, location, city, state, country, postcode },
      dietaryRestrictions,
    });

    const creator = await prisma.user.findUnique({ where: { id: userid }, select: { name: true } });
    await logChange(
      `${creator?.name || 'Unknown Creator'} submitted logistics information`,
      campaignId,
      req,
      undefined,
      {
        address: address || null,
        dietaryRestrictions: dietaryRestrictions || null,
      },
    );

    return res.status(200).json(result);
  } catch (error) {
    console.error('Error submitting logistics info:', error);
    return res.status(500).json({ message: 'Failed to submit logistics as creator.' });
  }
};

export const upsertReservationConfig = async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;
    const { mode, locations, availabilityRules, allowMultipleBookings } = req.body;

    if (!campaignId) return res.status(400).json({ message: 'Campaign ID is required' });
    if (!mode || !locations || !availabilityRules || !allowMultipleBookings) {
      return res.status(400).json({ message: 'Missing required configuration fields' });
    }

    const config = await upsertReservationConfigService(campaignId, req.body);
    return res.status(200).json(config);
  } catch (error) {
    console.error('Error saving reservation config:', error);
    return res.status(500).json({ message: 'Failed to save reservation configuration' });
  }
};

export const getReservationConfig = async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;
    const config = await getReservationConfigService(campaignId);

    if (!config) {
      return res.status(200).json(null);
    }

    return res.status(200).json(config);
  } catch (error) {
    console.error('Error fetching reservation config:', error);
    return res.status(500).json({ message: 'Failed to retrieve reservation configuration.' });
  }
};

export const getReservationSlots = async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;
    const { month } = req.query;

    if (!month) return res.status(400).json({ message: 'Month date is required' });

    const slots = await getAvailableSlotsService(campaignId, new Date(month as string));
    return res.status(200).json(slots);
  } catch (error) {
    console.error('Error fetching slots:', error);
    return res.status(500).json({ message: 'Failed to retrieve reservation slots' });
  }
};

export const submitReservationDetails = async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;
    const { userid } = (req as any).session;
    const { outlet, phoneNumber, remarks, pax, selectedSlots } = req.body;

    if (!selectedSlots || selectedSlots.length === 0) {
      return res.status(400).json({ message: 'At least one time slot must be selected' });
    }

    const result = await submitReservationService(campaignId, {
      creatorId: userid,
      outlet,
      phoneNumber,
      remarks,
      pax: Number(pax),
      selectedSlots,
    });

    const creator = await prisma.user.findUnique({ where: { id: userid }, select: { name: true } });
    await logChange(`${creator?.name || 'Unknown Creator'} submitted reservation details`, campaignId, req, undefined, {
      outlet: outlet || null,
      pax: pax ? Number(pax) : null,
      remarks: remarks || null,
      selectedSlots: selectedSlots?.length > 0 ? selectedSlots : null,
    });

    return res.status(201).json(result);
  } catch (error) {
    console.error('Error submitting reservation:', error);
    return res.status(500).json({ message: 'Failed to submit reservation slots.' });
  }
};

const reservationDetailFields: FieldMapping[] = [
  { field: 'outlet', label: 'Outlet' },
  { field: 'picName', label: 'PIC Name' },
  { field: 'picContact', label: 'PIC Contact' },
  { field: 'budget', label: 'Budget' },
  { field: 'promoCode', label: 'Promo Code' },
  { field: 'clientRemarks', label: 'Client Remarks' },
];

export const updateReservationDetails = async (req: Request, res: Response) => {
  try {
    const { logisticId } = req.params;

    // Fetch current reservation details before update
    const oldDetails = await prisma.reservationDetails.findUnique({
      where: { logisticId },
    });

    const result = await updateReservationDetailService(logisticId, req.body);

    const { campaignId, creatorName } = await getLogisticContext(logisticId);

    // Compute diff — only log when something actually changed
    const changes = computeChanges(oldDetails || {}, req.body, reservationDetailFields);
    if (changes.length > 0) {
      await logChange(`Reservation details updated for ${creatorName}`, campaignId, req, undefined, {
        changes,
      });
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error('Error updating reservation details:', error);
    return res.status(500).json({ message: 'Failed to update reservation details.' });
  }
};

export const scheduleReservation = async (req: Request, res: Response) => {
  try {
    const { logisticId } = req.params;
    const { slotId, picName, picContact, budget, promoCode, clientRemarks, outlet } = req.body;

    if (!slotId) {
      return res.status(400).json({ message: 'A selected Slot ID is required to confirm' });
    }

    const result = await scheduleReservationService(logisticId, {
      slotId,
      picName,
      picContact,
      budget,
      promoCode,
      clientRemarks,
      outlet,
    });

    const { campaignId, creatorName } = await getLogisticContext(logisticId);

    // Fetch the confirmed slot's time range
    const confirmedSlot = await prisma.reservationSlot.findUnique({
      where: { id: slotId },
      select: { startTime: true, endTime: true },
    });

    await logChange(`Reservation confirmed for ${creatorName}`, campaignId, req, undefined, {
      outlet: outlet || null,
      startTime: confirmedSlot?.startTime || null,
      endTime: confirmedSlot?.endTime || null,
      picName: picName || null,
      picContact: picContact || null,
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error('Error confirming reservation:', error);
    return res.status(500).json({ message: 'Failed to schedule a reservation.' });
  }
};

export const rescheduleReservation = async (req: Request, res: Response) => {
  try {
    const { logisticId } = req.params;

    const result = await rescheduleReservationService(logisticId);

    const { campaignId, creatorName, outlet } = await getLogisticContext(logisticId);
    await logChange(
      `Reservation rescheduled for ${creatorName}`,
      campaignId,
      req,
      undefined,
      outlet ? { outlet } : undefined,
    );

    return res.status(200).json({ message: 'Reservation reset successfully', result });
  } catch (error) {
    console.error('Error rescheduling reservation:', error);
    return res.status(500).json({ message: 'Failed to reschedule a reservation.' });
  }
};

export const adminSchedule = async (req: Request, res: Response) => {
  try {
    const { logisticId } = req.params;
    const { startTime, endTime } = req.body;

    if (!startTime || !endTime) {
      return res.status(400).json({ message: 'Start and End times are required.' });
    }

    // Check if this is a reschedule (logistic already has SCHEDULED status)
    const currentLogistic = await prisma.logistic.findUnique({
      where: { id: logisticId },
      select: { status: true },
    });
    const isReschedule = currentLogistic?.status === 'SCHEDULED';

    const result = await adminScheduleService(logisticId, {
      startTime: new Date(startTime),
      endTime: new Date(endTime),
    });

    const { campaignId, creatorName, outlet } = await getLogisticContext(logisticId);
    const message = isReschedule
      ? `Admin rescheduled reservation for ${creatorName}`
      : `Admin scheduled reservation for ${creatorName}`;
    await logChange(message, campaignId, req, undefined, {
      startTime: startTime || null,
      endTime: endTime || null,
      outlet: outlet || null,
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error('Error scheduling reservation:', error);
    return res.status(500).json({
      message: error.message || 'An unexpected error occurred',
    });
  }
};

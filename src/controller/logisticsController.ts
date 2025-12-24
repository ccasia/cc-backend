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
  confirmReservationService,
  rescheduleReservationService,
} from '@services/logisticsService';

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
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

export const getCreatorLogistics = async (req: Request, res: Response) => {
  try {
    const { userid } = (req as any).session;

    const logistics = await fetchAllLogisticsForCreator(userid);
    return res.status(200).json(logistics);
  } catch (error) {
    console.error('Error fetching creator logistics:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
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
    return res.status(500).json({ message: 'Internal Server Error' });
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
    return res.status(500).json({ message: 'Internal Server Error' });
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
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

export const getProductsForCampaign = async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;
    const products = await fetchProductsForCampaign(campaignId);
    return res.status(200).json(products);
  } catch (error) {
    console.error('Error fetching products for campaign:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
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

    return res.status(201).json(logistic);
  } catch (error) {
    console.error('Error in singleAssignmentLogistics controller', error);
    res.status(500).json({ message: 'Internal Server Error' });
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

    return res.status(201).json(logistics);
  } catch (error) {
    console.error('Error in bulkAssignmentLogistics controller:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

export const scheduleDelivery = async (req: Request, res: Response) => {
  try {
    const { logisticId } = req.params;
    const logistic = await scheduleDeliveryService(logisticId, req.body);

    return res.status(200).json(logistic);
  } catch (error) {
    console.error('Error in scheduleDelivery controller:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
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
    return res.status(200).json(updatedDetails);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

export const markLogisticReceived = async (req: Request, res: Response) => {
  try {
    const { logisticId } = req.params;
    const updated = await updateDeliveryStatus(logisticId, 'RECEIVED');
    return res.status(200).json(updated);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

export const reportIssue = async (req: Request, res: Response) => {
  try {
    const { logisticId } = req.params;
    const { reason } = req.body;
    const { userid } = (req as any).session;

    const updated = await reportLogisticIssue(logisticId, reason, userid);
    return res.status(200).json(updated);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

export const updateLogisticStatus = async (req: Request, res: Response) => {
  try {
    const { logisticId } = req.params;
    const { status } = req.body;

    if (!status) return res.status(400).json({ message: 'Status is required' });

    const updatedStatus = await updateStatusService(logisticId, status);
    return res.status(200).json(updatedStatus);
  } catch (error) {
    console.error('Error updating status:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

export const adminUpdateLogisticDetails = async (req: Request, res: Response) => {
  try {
    const { logisticId } = req.params;

    const { items, address, phoneNumber, trackingLink, expectedDeliveryDate, dietaryRestrictions } = req.body;

    const updatedLogistic = await adminUpdateService(logisticId, {
      items,
      address,
      phoneNumber,
      trackingLink,
      expectedDeliveryDate,
      dietaryRestrictions,
    });

    return res.status(200).json(updatedLogistic);
  } catch (error) {
    console.error('Error admin updating logistic:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

export const resolveLogisticIssue = async (req: Request, res: Response) => {
  try {
    const { logisticId } = req.params;
    const { userid } = (req as any).session;

    const result = await resolveIssueService(logisticId, userid);
    return res.status(200).json(result);
  } catch (error) {
    console.error('Error resolving issue:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

export const retryLogisticDelivery = async (req: Request, res: Response) => {
  try {
    const { logisticId } = req.params;
    const { userid } = (req as any).session;

    const result = await retryDeliveryService(logisticId, userid);
    return res.status(200).json(result);
  } catch (error) {
    console.error('Error retrying delivery:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
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

    return res.status(200).json(result);
  } catch (error) {
    console.error('Error submitting logistics info:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

export const upsertReservationConfig = async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;
    const { mode, locations, startDate, endDate, startTime, endTime, interval } = req.body;

    if (!campaignId) return res.status(400).json({ message: 'Campaign ID is required' });
    if (!mode || !locations || !startDate || !endDate || !startTime || !endTime || !interval) {
      return res.status(400).json({ message: 'Missing required configuration fields' });
    }

    const config = await upsertReservationConfigService(campaignId, req.body);
    return res.status(200).json(config);
  } catch (error) {
    console.error('Error saving reservation config:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
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
    return res.status(500).json({ message: 'Internal Server Error' });
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
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

export const updateReservationDetails = async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;
    const { userid } = (req as any).session;
    const { outlet, contactNumber, remarks, pax, selectedSlots } = req.body;

    if (!selectedSlots || selectedSlots.length === 0) {
      return res.status(400).json({ message: 'At least one time slot must be selected' });
    }

    const result = await submitReservationService(campaignId, {
      creatorId: userid,
      outlet,
      contactNumber,
      remarks,
      pax: Number(pax),
      selectedSlots,
    });

    return res.status(201).json(result);
  } catch (error) {
    console.error('Error submitting reservation:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

export const confirmReservation = async (req: Request, res: Response) => {
  try {
    const { logisticId } = req.params;
    const { slotId, picName, picContact, budget, promoCode, clientRemarks, outlet } = req.body;

    if (!slotId) {
      return res.status(400).json({ message: 'A selected Slot ID is required to confirm' });
    }

    const result = await confirmReservationService(logisticId, {
      slotId,
      picName,
      picContact,
      budget,
      promoCode,
      clientRemarks,
      outlet,
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error('Error confirming reservation:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

export const rescheduleReservation = async (req: Request, res: Response) => {
  try {
    const { logisticId } = req.params;

    const result = await rescheduleReservationService(logisticId);

    return res.status(200).json({ message: 'Reservation reset successfully', result });
  } catch (error) {
    console.error('Error rescheduling reservation:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

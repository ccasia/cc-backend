import { Request, Response } from 'express';
import {
  fetchAllLogisticsForCampaign,
  fetchAllLogisticsForCreator,
  fetchCampaignLogisticForCreator,
  fetchProductsForCampaign,
  createProductForLogistic,
  assignBulkCreators,
  assignSingleCreator,
  scheduleDeliveryService,
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

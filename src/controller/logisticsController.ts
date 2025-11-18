import { Request, Response } from 'express';
import {
  fetchAllLogisticsForCampaign,
  fetchAllLogisticsForCreator,
  fetchCampaignLogisticForCreator,
  fetchProductsForCampaign,
  createProductForLogistic,
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

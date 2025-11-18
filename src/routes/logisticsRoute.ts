import express from 'express';
import { isLoggedIn } from '@middlewares/onlyLogin';
import { isCreator } from '@middlewares/isCreator';
import { isAdminOrClient } from '@middlewares/adminOrClient';
import { isSuperAdmin } from '@middlewares/onlySuperadmin';
import { checkCampaignAccess } from '@middlewares/checkCampaignAccess';

import {
  getCreatorLogistics,
  getLogisticsForCampaign,
  getCreatorLogisticForCampaign,
  getProductsForCampaign,
  createProduct,
} from '@controllers/logisticsController';

const router = express.Router();

// creator routes
router.get('/me', isLoggedIn, isCreator, getCreatorLogistics); // maybe no need
router.get('/creator/campaign/:campaignId', isLoggedIn, isCreator, getCreatorLogisticForCampaign);

// admin & client routes
router.get(
  '/campaign/:campaignId',
  isLoggedIn,
  isAdminOrClient,
  isSuperAdmin,
  checkCampaignAccess,
  getLogisticsForCampaign,
);
router.get('/products/campaign/:campaignId', isLoggedIn, isAdminOrClient, checkCampaignAccess, getProductsForCampaign);
router.post('/products/:campaignId', isLoggedIn, isAdminOrClient, checkCampaignAccess, createProduct);

export default router;

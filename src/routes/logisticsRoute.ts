import express from 'express';
import { isLoggedIn } from '@middlewares/onlyLogin';
import { isCreator } from '@middlewares/isCreator';
import { isAdminOrClient } from '@middlewares/adminOrClient';
import { isSuperAdmin } from '@middlewares/onlySuperadmin';
import { checkCampaignAccess } from '@middlewares/checkCampaignAccess';

import { getCreatorLogistics, getLogisticsForCampaign } from '@controllers/logisticsController';

const router = express.Router();

// creator routes
router.get('/me', isLoggedIn, isCreator, getCreatorLogistics);

// admin & client routes
router.get('/campaign/:campaignId', isLoggedIn, isAdminOrClient, isSuperAdmin, checkCampaignAccess, getLogisticsForCampaign);

export default router;

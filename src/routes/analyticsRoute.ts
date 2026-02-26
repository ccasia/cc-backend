import { Router } from 'express';

import { isLoggedIn } from '@middlewares/onlyLogin';
import { isSuperAdmin } from '@middlewares/onlySuperadmin';
import {
  getClientActivationMetrics,
  getClientApprovalMetrics,
  getClientCampaignMetrics,
  getClientJourneyMetrics,
  getClientShortlistMetrics,
  getClientSupportMetrics,
  trackUserFlow,
} from '@controllers/analyticsController';

const router = Router();

router.post('/tracker', trackUserFlow);

router.get('/client/activation', isLoggedIn, getClientActivationMetrics);
router.get('/client/approve', isLoggedIn, getClientApprovalMetrics);
router.get('/client/journey', isLoggedIn, getClientJourneyMetrics);
router.get('/client/support', isLoggedIn, getClientSupportMetrics);
router.get('/client/campaigns', isLoggedIn, getClientCampaignMetrics);
router.get('/client/shortlist', isLoggedIn, getClientShortlistMetrics);

export default router;

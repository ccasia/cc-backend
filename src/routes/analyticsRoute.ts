import { Router } from 'express';

import { authenticate } from '@middlewares/authenticate';
import { isSuperAdmin } from '@middlewares/onlySuperadmin';
import {
  getBrandsMetrics,
  getClientApprovalMetrics,
  getClientCampaignMetrics,
  getClientJourneyMetrics,
  getClientShortlistMetrics,
  getClientSupportMetrics,
  trackUserFlow,
} from '@controllers/analyticsController';

const router = Router();

router.post('/tracker', trackUserFlow);

router.get('/client/brands', authenticate, getBrandsMetrics);
router.get('/client/approve', authenticate, getClientApprovalMetrics);
router.get('/client/journey', authenticate, getClientJourneyMetrics);
router.get('/client/support', authenticate, getClientSupportMetrics);
router.get('/client/campaigns', authenticate, getClientCampaignMetrics);
router.get('/client/shortlist', authenticate, getClientShortlistMetrics);

export default router;

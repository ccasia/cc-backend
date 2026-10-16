import { Router } from 'express';
import { authenticate } from '@middlewares/authenticate';
import { isClient } from '@middlewares/clientOnly';
import { getCampaignOverviewHandler } from './overview.controller';

// Mounted at /campaign/:campaignId/overview
const router = Router({ mergeParams: true });

router.get('/', authenticate, isClient, getCampaignOverviewHandler);

export default router;

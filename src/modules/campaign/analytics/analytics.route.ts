import { authenticate } from '@/src/middleware/authenticate';
import { Router } from 'express';
import { getCampaignAnalytics } from './analytics.controller';

const router = Router({ mergeParams: true });

router.get('/', authenticate, getCampaignAnalytics);

export default router;

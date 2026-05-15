import { Router } from 'express';
import { getDashboardStats, getDashboardCampaigns } from '@controllers/dashboardController';
import { authenticate } from '@middlewares/authenticate';

const router = Router();

// Dashboard statistics endpoint
router.get('/stats', authenticate, getDashboardStats);
// Dashboard campaigns endpoint (lightweight)
router.get('/campaigns', authenticate, getDashboardCampaigns);

export default router;

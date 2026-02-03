import { Router } from 'express';
import { getDashboardStats, getDashboardCampaigns } from '@controllers/dashboardController';
import { isLoggedIn } from '@middlewares/onlyLogin';

const router = Router();

// Dashboard statistics endpoint
router.get('/stats', isLoggedIn, getDashboardStats);
// Dashboard campaigns endpoint (lightweight)
router.get('/campaigns', isLoggedIn, getDashboardCampaigns);

export default router;
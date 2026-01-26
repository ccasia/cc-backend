import { Router } from 'express';
import { getDashboardStats } from '@controllers/dashboardController';
import { isLoggedIn } from '@middlewares/onlyLogin';

const router = Router();

// Dashboard statistics endpoint
router.get('/stats', isLoggedIn, getDashboardStats);

export default router;
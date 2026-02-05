import { Router } from 'express';

import { isLoggedIn } from '@middlewares/onlyLogin';
import { isClient } from '@middlewares/clientOnly';
import { isSuperAdmin } from '@middlewares/onlySuperadmin';
import { submitFeedback, getAllFeedback, getFeedbackStats } from '@controllers/npsFeedbackController';

const router = Router();

// Client submits NPS feedback
router.post('/', isLoggedIn, isClient, submitFeedback);

// Superadmin views
router.get('/stats', isLoggedIn, isSuperAdmin, getFeedbackStats);
router.get('/', isLoggedIn, isSuperAdmin, getAllFeedback);

export default router;

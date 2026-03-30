import { Router } from 'express';

import { isLoggedIn } from '@middlewares/onlyLogin';
import { isSuperAdmin } from '@middlewares/onlySuperadmin';
import { isCreator, isCreatorOrClient } from '@middlewares/isCreator';
import { submitFeedback, getAllFeedback, getFeedbackStats, checkCreatorNps } from '@controllers/npsFeedbackController';

const router = Router();

// Client or creator submits NPS feedback
router.post('/', isLoggedIn, isCreatorOrClient, submitFeedback);

// Creator NPS check (must be before the GET / route to avoid conflict)
router.get('/check-creator', isLoggedIn, isCreator, checkCreatorNps);

// Superadmin views
router.get('/stats', isLoggedIn, isSuperAdmin, getFeedbackStats);
router.get('/', isLoggedIn, isSuperAdmin, getAllFeedback);

export default router;

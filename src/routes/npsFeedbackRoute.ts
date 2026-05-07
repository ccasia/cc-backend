import { Router } from 'express';

import { authenticate } from '@middlewares/onlyLogin';
import { isSuperAdmin } from '@middlewares/onlySuperadmin';
import { isCreator, isCreatorOrClient } from '@middlewares/isCreator';
import { submitFeedback, getAllFeedback, getFeedbackStats, checkCreatorNps } from '@controllers/npsFeedbackController';

const router = Router();

// Client or creator submits NPS feedback
router.post('/', authenticate, isCreatorOrClient, submitFeedback);

// Creator NPS check (must be before the GET / route to avoid conflict)
router.get('/check-creator', authenticate, isCreator, checkCreatorNps);

// Superadmin views
router.get('/stats', authenticate, isSuperAdmin, getFeedbackStats);
router.get('/', authenticate, isSuperAdmin, getAllFeedback);

export default router;

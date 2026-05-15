import { getAllSubscriptions, updateSubscription, syncSubscriptionCredits } from '@controllers/subscriptionController';
import { isSuperAdmin } from '@middlewares/onlySuperadmin';
import { authenticate } from '@middlewares/authenticate';
import { Router } from 'express';

const router = Router();

router.get('/', isSuperAdmin, getAllSubscriptions);
router.patch('/:id', authenticate, isSuperAdmin, updateSubscription);
router.post('/:id/sync-credits', authenticate, isSuperAdmin, syncSubscriptionCredits);
export default router;

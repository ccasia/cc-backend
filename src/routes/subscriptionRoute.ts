import { getAllSubscriptions, updateSubscription, syncSubscriptionCredits } from '@controllers/subscriptionController';
import { isSuperAdmin } from '@middlewares/onlySuperadmin';
import { isLoggedIn } from '@middlewares/onlyLogin';
import { Router } from 'express';

const router = Router();

router.get('/', isSuperAdmin, getAllSubscriptions);
router.patch('/:id', isLoggedIn, isSuperAdmin, updateSubscription);
router.post('/:id/sync-credits', isLoggedIn, isSuperAdmin, syncSubscriptionCredits);
export default router;

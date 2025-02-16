import { getAllSubscriptions } from '@controllers/subscriptionController';
import { isSuperAdmin } from '@middlewares/onlySuperadmin';
import { Router } from 'express';

const router = Router();

router.get('/', isSuperAdmin, getAllSubscriptions);

export default router;

import { Router } from 'express';
import { getCreatorGrowth } from '@controllers/analyticsV2Controller';
import { isLoggedIn } from '@middlewares/onlyLogin';
import { isSuperAdmin } from '@middlewares/onlySuperadmin';

const router = Router();

router.get('/creator-growth', isLoggedIn, isSuperAdmin, getCreatorGrowth);

export default router;

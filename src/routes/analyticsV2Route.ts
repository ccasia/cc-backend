import { Router } from 'express';
import { getCreatorGrowth, getActivationRate, getTimeToActivation, getTimeToActivationCreators } from '@controllers/analyticsV2Controller';
import { isLoggedIn } from '@middlewares/onlyLogin';
import { isSuperAdmin } from '@middlewares/onlySuperadmin';

const router = Router();

router.get('/creator-growth', isLoggedIn, isSuperAdmin, getCreatorGrowth);
router.get('/activation-rate', isLoggedIn, isSuperAdmin, getActivationRate);
router.get('/time-to-activation', isLoggedIn, isSuperAdmin, getTimeToActivation);
router.get('/time-to-activation/creators', isLoggedIn, isSuperAdmin, getTimeToActivationCreators);

export default router;

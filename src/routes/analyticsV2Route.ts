import { Router } from 'express';
import {
  getCreatorGrowth,
  getActivationRate,
  getPitchRate,
  getTimeToActivation,
  getTimeToActivationCreators,
  getPitchRateCreators,
  getMediaKitActivation,
  getCreatorSatisfaction,
} from '@controllers/analyticsV2Controller';
import { isLoggedIn } from '@middlewares/onlyLogin';
import { isSuperAdmin } from '@middlewares/onlySuperadmin';

const router = Router();

router.get('/creator-growth', isLoggedIn, isSuperAdmin, getCreatorGrowth);
router.get('/activation-rate', isLoggedIn, isSuperAdmin, getActivationRate);
router.get('/pitch-rate', isLoggedIn, isSuperAdmin, getPitchRate);
router.get('/time-to-activation', isLoggedIn, isSuperAdmin, getTimeToActivation);
router.get('/time-to-activation/creators', isLoggedIn, isSuperAdmin, getTimeToActivationCreators);
router.get('/pitch-rate/creators', isLoggedIn, isSuperAdmin, getPitchRateCreators);
router.get('/media-kit-activation', isLoggedIn, isSuperAdmin, getMediaKitActivation);
router.get('/creator-satisfaction', isLoggedIn, isSuperAdmin, getCreatorSatisfaction);

export default router;

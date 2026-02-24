import { Router } from 'express';
import {
  getCreatorGrowth,
  getCreatorGrowthCreators,
  getActivationRate,
  getPitchRate,
  getTimeToActivation,
  getTimeToActivationCreators,
  getPitchRateCreators,
  getMediaKitActivation,
  getCreatorSatisfaction,
  getCreatorEarnings,
  getAvgAgreementResponse,
  getAvgAgreementResponseDetails,
  getAvgFirstCampaign,
  getAvgFirstCampaignDetails,
  getAvgSubmissionResponse,
  getAvgSubmissionResponseDetails,
} from '@controllers/analyticsV2Controller';
import { isLoggedIn } from '@middlewares/onlyLogin';
import { isSuperAdmin } from '@middlewares/onlySuperadmin';

const router = Router();

router.get('/creator-growth', isLoggedIn, isSuperAdmin, getCreatorGrowth);
router.get('/creator-growth/creators', isLoggedIn, isSuperAdmin, getCreatorGrowthCreators);
router.get('/activation-rate', isLoggedIn, isSuperAdmin, getActivationRate);
router.get('/pitch-rate', isLoggedIn, isSuperAdmin, getPitchRate);
router.get('/time-to-activation', isLoggedIn, isSuperAdmin, getTimeToActivation);
router.get('/time-to-activation/creators', isLoggedIn, isSuperAdmin, getTimeToActivationCreators);
router.get('/pitch-rate/creators', isLoggedIn, isSuperAdmin, getPitchRateCreators);
router.get('/media-kit-activation', isLoggedIn, isSuperAdmin, getMediaKitActivation);
router.get('/creator-satisfaction', isLoggedIn, isSuperAdmin, getCreatorSatisfaction);
router.get('/creator-earnings', isLoggedIn, isSuperAdmin, getCreatorEarnings);
router.get('/avg-agreement-response', isLoggedIn, isSuperAdmin, getAvgAgreementResponse);
router.get('/avg-agreement-response/details', isLoggedIn, isSuperAdmin, getAvgAgreementResponseDetails);
router.get('/avg-first-campaign', isLoggedIn, isSuperAdmin, getAvgFirstCampaign);
router.get('/avg-first-campaign/details', isLoggedIn, isSuperAdmin, getAvgFirstCampaignDetails);
router.get('/avg-submission-response', isLoggedIn, isSuperAdmin, getAvgSubmissionResponse);
router.get('/avg-submission-response/details', isLoggedIn, isSuperAdmin, getAvgSubmissionResponseDetails);

export default router;

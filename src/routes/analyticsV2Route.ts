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
  getClientRejectionRate,
  getCreditsPerCS,
  getRejectionReasons,
  getRequireChangesRate,
  getTopShortlistedCreators,
  getBrandsMetrics,
  trackUserFlow,
  getClientApprovalMetrics,
  getClientCampaignMetrics,
  getClientJourneyMetrics,
  getClientShortlistMetrics,
  getClientSupportMetrics,
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
router.get('/client-rejection-rate', isLoggedIn, isSuperAdmin, getClientRejectionRate);
router.get('/credits-per-cs', isLoggedIn, isSuperAdmin, getCreditsPerCS);
router.get('/rejection-reasons', isLoggedIn, isSuperAdmin, getRejectionReasons);
router.get('/require-changes-rate', isLoggedIn, isSuperAdmin, getRequireChangesRate);
router.get('/top-shortlisted-creators', isLoggedIn, isSuperAdmin, getTopShortlistedCreators);

router.post('/tracker', isLoggedIn, trackUserFlow);

router.get('/client/brands', isLoggedIn, isSuperAdmin, getBrandsMetrics);
router.get('/client/approve', isLoggedIn, isSuperAdmin, getClientApprovalMetrics);
router.get('/client/journey', isLoggedIn, isSuperAdmin, getClientJourneyMetrics);
router.get('/client/support', isLoggedIn, isSuperAdmin, getClientSupportMetrics);
router.get('/client/campaigns', isLoggedIn, isSuperAdmin, getClientCampaignMetrics);
router.get('/client/shortlist', isLoggedIn, isSuperAdmin, getClientShortlistMetrics);

export default router;

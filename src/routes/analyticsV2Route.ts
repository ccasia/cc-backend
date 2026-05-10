import { Router } from 'express';
import {
  getCreatorGrowth,
  getCreatorGrowthCreators,
  getCreatorsByCountry,
  getActivationRate,
  getPitchRate,
  getTimeToActivation,
  getTimeToActivationCreators,
  getTimeToIgActivation,
  getTimeToIgActivationCreators,
  getTimeToTiktokActivation,
  getTimeToTiktokActivationCreators,
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
import { authenticate } from '@middlewares/authenticate';
import { isSuperAdmin } from '@middlewares/onlySuperadmin';

const router = Router();

router.get('/creator-growth', authenticate, isSuperAdmin, getCreatorGrowth);
router.get('/creator-growth/creators', authenticate, isSuperAdmin, getCreatorGrowthCreators);
router.get('/creator-growth/creators-by-country', authenticate, isSuperAdmin, getCreatorsByCountry);
router.get('/activation-rate', authenticate, isSuperAdmin, getActivationRate);
router.get('/pitch-rate', authenticate, isSuperAdmin, getPitchRate);
router.get('/time-to-activation', authenticate, isSuperAdmin, getTimeToActivation);
router.get('/time-to-activation/creators', authenticate, isSuperAdmin, getTimeToActivationCreators);
router.get('/time-to-ig-activation', authenticate, isSuperAdmin, getTimeToIgActivation);
router.get('/time-to-ig-activation/creators', authenticate, isSuperAdmin, getTimeToIgActivationCreators);
router.get('/time-to-tiktok-activation', authenticate, isSuperAdmin, getTimeToTiktokActivation);
router.get('/time-to-tiktok-activation/creators', authenticate, isSuperAdmin, getTimeToTiktokActivationCreators);
router.get('/pitch-rate/creators', authenticate, isSuperAdmin, getPitchRateCreators);
router.get('/media-kit-activation', authenticate, isSuperAdmin, getMediaKitActivation);
router.get('/creator-satisfaction', authenticate, isSuperAdmin, getCreatorSatisfaction);
router.get('/creator-earnings', authenticate, isSuperAdmin, getCreatorEarnings);
router.get('/avg-agreement-response', authenticate, isSuperAdmin, getAvgAgreementResponse);
router.get('/avg-agreement-response/details', authenticate, isSuperAdmin, getAvgAgreementResponseDetails);
router.get('/avg-first-campaign', authenticate, isSuperAdmin, getAvgFirstCampaign);
router.get('/avg-first-campaign/details', authenticate, isSuperAdmin, getAvgFirstCampaignDetails);
router.get('/avg-submission-response', authenticate, isSuperAdmin, getAvgSubmissionResponse);
router.get('/avg-submission-response/details', authenticate, isSuperAdmin, getAvgSubmissionResponseDetails);
router.get('/client-rejection-rate', authenticate, isSuperAdmin, getClientRejectionRate);
router.get('/credits-per-cs', authenticate, isSuperAdmin, getCreditsPerCS);
router.get('/rejection-reasons', authenticate, isSuperAdmin, getRejectionReasons);
router.get('/require-changes-rate', authenticate, isSuperAdmin, getRequireChangesRate);
router.get('/top-shortlisted-creators', authenticate, isSuperAdmin, getTopShortlistedCreators);

router.post('/tracker', authenticate, trackUserFlow);

router.get('/client/brands', authenticate, isSuperAdmin, getBrandsMetrics);
router.get('/client/approve', authenticate, isSuperAdmin, getClientApprovalMetrics);
router.get('/client/journey', authenticate, isSuperAdmin, getClientJourneyMetrics);
router.get('/client/support', authenticate, isSuperAdmin, getClientSupportMetrics);
router.get('/client/campaigns', authenticate, isSuperAdmin, getClientCampaignMetrics);
router.get('/client/shortlist', authenticate, isSuperAdmin, getClientShortlistMetrics);

export default router;

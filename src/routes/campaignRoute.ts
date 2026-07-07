import { Router } from 'express';
import {
  createCampaign,
  createCampaignV2,
  getAllCampaigns,
  getCampaignById,
  getAllActiveCampaign,
  creatorMakePitch,
  changeCampaignStage,
  closeCampaign,
  getPitchById,
  editCampaignInfo,
  editCampaignObjectives,
  editCampaignBrandOrCompany,
  editCampaignDosAndDonts,
  editCampaignRequirements,
  editCampaignLogistics,
  editCampaignFinalise,
  editCampaignAdditionalDetails,
  editCampaignTimeline,
  changePitchStatus,
  getCampaignsByCreatorId,
  getCampaignForCreatorById,
  getCampaignPitchForCreator,
  matchCampaignWithCreator,
  getCampaignLog,
  getSubmission,
  uploadVideoTest,
  getAllCampaignsFinance,
  saveCampaign,
  unSaveCampaign,
  shortlistCreator,
  rateCreator,
  creatorAgreements,
  updateAmountAgreement,
  sendAgreement,
  resendAgreement,
  editCampaignImages,
  draftPitch,
  getMyCampaigns,
  removePitchVideo,
  editCampaignAdmin,
  editCampaignAttachments,
  createNewSpreadSheets,
  editCampaignReference,
  linkNewAgreement,
  getAllCampaignsByAdminId,
  removeCreatorFromCampaign,
  getCampaignsTotal,
  shortlistCreatorV2,
  shortlistCreatorV2ForClient,
  shortlistCreatorV3,
  assignUGCCreditsV3,
  shortlistGuestCreators,
  getAllPitches,
  getAllCreatorAgreements,
  getClientCampaigns,
  activateClientCampaign,
  activateCampaignFull,
  initialActivateCampaign,
  checkCampaignAdmin,
  addClientToCampaignAdmin,
  fixCampaignTimelines,
  checkCampaignCreatorVisibility,
  updateCampaignOrigin,
  changeCampaignCredit,
  getCampaignsForPublic,
  exportActiveCompletedToSheet,
  exportCreatorsCampaignSheet,
  syncCampaignCredits,
  updateAllCampaignCredits,
  getCampaignStatus,
  submitDraftForReview,
  getDraftCampaigns,
  deleteDraftCampaign,
  unlinkCampaignCompany,
} from '@controllers/campaignController';
import {
  swapGuestWithPlatformCreator,
  cleanupOrphanedGuestUsers,
  getGuestCreatorsForCampaign,
} from '@controllers/swapCreatorController';
import { getPCRData, savePCRData } from '@controllers/pcrController';
import { markPCRAsReady } from '@controllers/campaignController';
import {
  getEngagementHeatmapController,
  getTopCreatorsTrendController,
  getTrendsSummaryController,
  refreshCampaignInsightsController,
} from '@controllers/trendController';
import {
  createEntry as createManualCreator,
  getEntries as getManualCreators,
  deleteEntry as deleteManualCreator,
  updateEntry as updateManualCreator,
} from '@controllers/manualCreatorController';
import {
  getCampaignPostSnapshots,
  triggerManualSnapshot,
  getPostDailyTrend,
  getPostDailyTrendByUrl,
  getCampaignDailyTrends,
  triggerDailyCapture,
} from '@controllers/postEngagementSnapshotController';
import { isSuperAdmin, isAdmin, isBdOrSuperadmin } from '@middlewares/onlySuperadmin';
import { canActivateCampaign } from '@middlewares/adminOrClient';

import {
  createNewTimeline,
  createSingleTimelineType,
  deleteTimelineType,
  getDefaultTimeline,
  getTimelineType,
  updateOrCreateDefaultTimeline,
} from '@controllers/timelineController';
import { authenticate } from '@middlewares/authenticate';

import { createNewTemplate, getAllTemplate, getTemplatebyId } from '@controllers/templateController';

const router = Router();

router.get('/total', authenticate, isSuperAdmin, getCampaignsTotal);

router.get('/template', authenticate, isSuperAdmin, getAllTemplate);
router.get('/template/:id', getTemplatebyId);

router.get('/getAllCampaignsByAdminID', authenticate, isSuperAdmin, getAllCampaigns);

router.get('/getCampaignById/:id', authenticate, isSuperAdmin, getCampaignById);
router.get('/getClientByCampID/:id', getCampaignById);

router.get('/getAllCampaignsFinance', authenticate, getAllCampaignsFinance);

router.get('/getAllActiveCampaign', getAllActiveCampaign);
router.get('/matchCampaignWithCreator', authenticate, matchCampaignWithCreator);
router.get('/pitch/:id', authenticate, getPitchById);

router.get('/timelineType', authenticate, isSuperAdmin, getTimelineType);
router.get('/defaultTimeline', authenticate, isSuperAdmin, getDefaultTimeline);
router.get('/getCampaignsBySessionId', authenticate, getCampaignsByCreatorId);
router.get('/getCampaignForCreatorById/:id', authenticate, getCampaignForCreatorById);
router.get('/getCampaignPitch', authenticate, getCampaignPitchForCreator);

router.get('/getSubmissions', getSubmission);

router.get('/getCampaignLog/:id', getCampaignLog);
router.get('/creatorAgreements/:campaignId', creatorAgreements);

// For Analytics
router.get('/pitches', authenticate, getAllPitches);
router.get('/getCreatorAgreements', authenticate, isSuperAdmin, getAllCreatorAgreements);

// For creator MyCampaigns
router.get('/getMyCampaigns/:userId', authenticate, getMyCampaigns);

// Get Campaigns by Admin ID
router.get('/getAllCampaignsByAdminId/:userId', getAllCampaignsByAdminId);

router.get('/campaignStatus', authenticate, getCampaignStatus);

// Get Campaigns for Client users
router.get('/getClientCampaigns', authenticate, getClientCampaigns);

// Debug endpoint to check campaign admin entries
router.get('/checkCampaignAdmin', authenticate, checkCampaignAdmin);

// Debug endpoint to update campaign origin for testing
router.post('/updateCampaignOrigin', authenticate, updateCampaignOrigin);

// Debug endpoint to add client to campaign admin for all company campaigns
router.post('/addClientToCampaignAdmin', authenticate, addClientToCampaignAdmin);

// Fix campaign timelines for creator discovery
router.post('/fixCampaignTimelines/:campaignId', authenticate, fixCampaignTimelines);

// Check if a campaign meets all requirements to be visible to creators
router.get('/checkCreatorVisibility/:campaignId', authenticate, checkCampaignCreatorVisibility);

router.get('/public', getCampaignsForPublic);

// Swap Creator endpoints
router.get('/:campaignId/guestCreators', authenticate, getGuestCreatorsForCampaign);
router.post('/swapCreator', authenticate, isSuperAdmin, swapGuestWithPlatformCreator);
router.post('/cleanupGuestCreators', authenticate, isSuperAdmin, cleanupOrphanedGuestUsers);

// Get Campaigns for Client users
router.get('/getClientCampaigns', authenticate, getClientCampaigns);

// Debug endpoint to check campaign admin entries
router.get('/checkCampaignAdmin', authenticate, checkCampaignAdmin);

// Debug endpoint to update campaign origin for testing
router.post('/updateCampaignOrigin', authenticate, updateCampaignOrigin);

// Debug endpoint to add client to campaign admin for all company campaigns
router.post('/addClientToCampaignAdmin', authenticate, addClientToCampaignAdmin);

// Fix campaign timelines for creator discovery
router.post('/fixCampaignTimelines/:campaignId', authenticate, fixCampaignTimelines);

// Check if a campaign meets all requirements to be visible to creators
router.get('/checkCreatorVisibility/:campaignId', authenticate, checkCampaignCreatorVisibility);

router.get('/public', getCampaignsForPublic);

router.post('/updateOrCreateDefaultTimeline', updateOrCreateDefaultTimeline);
router.post('/createCampaign', authenticate, isSuperAdmin, createCampaign);
router.post('/createCampaignV2', authenticate, isSuperAdmin, createCampaignV2);
router.post('/createNewTimeline', authenticate, isSuperAdmin, createNewTimeline);
router.post('/createSingleTimelineType', authenticate, isSuperAdmin, createSingleTimelineType);
router.post('/uploadVideo', authenticate, uploadVideoTest);
router.post('/saveCampaign', authenticate, saveCampaign);

router.post('/shortlistCreator', authenticate, isSuperAdmin, shortlistCreator);
router.post('/rateCreator', authenticate, rateCreator);
router.post('/template/:id', authenticate, isSuperAdmin, createNewTemplate);
router.post('/draftPitch', authenticate, draftPitch);
router.post('/spreadsheet', authenticate, isSuperAdmin, createNewSpreadSheets);
router.post('/export/active-completed', authenticate, isSuperAdmin, exportActiveCompletedToSheet);
router.post('/export/campaign-creators', authenticate, isSuperAdmin, exportCreatorsCampaignSheet);
router.post('/removeCreatorFromCampaign', authenticate, isSuperAdmin, removeCreatorFromCampaign);
router.post('/v2/shortlistCreator', authenticate, isSuperAdmin, shortlistCreatorV2);
router.post('/v2/shortlistCreator/client', authenticate, isSuperAdmin, shortlistCreatorV2ForClient);
router.post('/v3/shortlistCreator', authenticate, shortlistCreatorV3);
router.post('/v3/shortlistCreator/guest', authenticate, shortlistGuestCreators);
router.post('/v3/assignUGCCredits', authenticate, assignUGCCreditsV3);

router.patch('/v4/changeCredits', authenticate, isSuperAdmin, changeCampaignCredit);

// Credit management routes
router.post('/syncCredits/:campaignId', authenticate, syncCampaignCredits);
router.patch('/updateAllCredits', authenticate, isSuperAdmin, updateAllCampaignCredits);

router.patch('/pitch', authenticate, creatorMakePitch);
router.patch('/changeCampaignStage/:campaignId', authenticate, changeCampaignStage);
router.patch('/closeCampaign/:id', authenticate, isSuperAdmin, closeCampaign);
router.patch('/editCampaignInfo', authenticate, isBdOrSuperadmin, editCampaignInfo);
router.patch('/editCampaignObjectives', authenticate, isBdOrSuperadmin, editCampaignObjectives);
router.patch('/editCampaignBrandOrCompany', authenticate, isBdOrSuperadmin, editCampaignBrandOrCompany);
router.patch('/editCampaignDosAndDonts', authenticate, isSuperAdmin, editCampaignDosAndDonts);
router.patch('/editCampaignRequirements', authenticate, isBdOrSuperadmin, editCampaignRequirements);
router.patch('/editCampaignLogistics', authenticate, isSuperAdmin, editCampaignLogistics);
router.patch('/editCampaignFinalise', authenticate, isSuperAdmin, editCampaignFinalise);
router.patch('/editCampaignAdditionalDetails', authenticate, isSuperAdmin, editCampaignAdditionalDetails);
router.patch('/editCampaignTimeline/:id', authenticate, isSuperAdmin, editCampaignTimeline);
router.patch('/editCampaignImages/:id', authenticate, isSuperAdmin, editCampaignImages);
router.patch('/editCampaignAdmins/:id', authenticate, isSuperAdmin, editCampaignAdmin);
router.patch('/editCampaignAttachments/:id', authenticate, isSuperAdmin, editCampaignAttachments);
router.patch('/editCampaignReference/:id', authenticate, isSuperAdmin, editCampaignReference);
router.patch('/changePitchStatus', authenticate, isSuperAdmin, changePitchStatus);
// router.patch('/changeLogisticStatus', isSuperAdmin, updateStatusLogistic); //need permission later
// router.patch('/receiveLogistic', authenticate, receiveLogistic);
router.patch('/updateAmountAgreement', authenticate, isSuperAdmin, updateAmountAgreement);
router.patch('/sendAgreement', authenticate, isSuperAdmin, sendAgreement);
router.patch('/resendAgreement', authenticate, resendAgreement);
router.patch('/removePitchVideo', authenticate, removePitchVideo);
router.patch('/linkNewAgreement', authenticate, isSuperAdmin, linkNewAgreement);
router.patch('/changeCredits', authenticate, isSuperAdmin, changeCampaignCredit);

router.delete('/timelineType/:id', authenticate, isSuperAdmin, deleteTimelineType);
router.delete('/unsaveCampaign/:id', authenticate, unSaveCampaign);

// Client campaign activation by CSM
router.post('/activateClientCampaign/:campaignId', authenticate, canActivateCampaign, activateClientCampaign);
router.post('/activateCampaignFull/:campaignId', authenticate, canActivateCampaign, activateCampaignFull);
router.post('/initialActivateCampaign/:campaignId', authenticate, canActivateCampaign, initialActivateCampaign);

// Campaign Trends Analytics endpoints
router.get('/:campaignId/trends/engagement-heatmap', authenticate, getEngagementHeatmapController);
router.get('/:campaignId/trends/top-creators', getTopCreatorsTrendController);
router.get('/:campaignId/trends/summary', authenticate, getTrendsSummaryController);
router.post('/:campaignId/trends/refresh', authenticate, isSuperAdmin, refreshCampaignInsightsController);

// PCR (Post Campaign Report) endpoints
router.get('/:campaignId/pcr', authenticate, getPCRData);
router.post('/:campaignId/pcr', authenticate, savePCRData);
router.patch('/:id/pcr-ready', authenticate, isAdmin, markPCRAsReady);

// Manual Creator Entry endpoints (for campaign analytics)
router.post('/:campaignId/manual-creator', authenticate, isAdmin, createManualCreator);
router.get('/:campaignId/manual-creators', authenticate, getManualCreators);
router.put('/:campaignId/manual-creator/:entryId', authenticate, isAdmin, updateManualCreator);
router.delete('/:campaignId/manual-creator/:entryId', authenticate, isAdmin, deleteManualCreator);

// Post Engagement Snapshot endpoints (Day 7, 15, 30 ER tracking)
router.get('/:campaignId/post-engagement-snapshots', authenticate, getCampaignPostSnapshots);
router.post('/:campaignId/post-engagement-snapshots/capture', authenticate, isAdmin, triggerManualSnapshot);

// Daily per-post engagement trend endpoints
router.get('/:campaignId/post-engagement-snapshots/daily', authenticate, getCampaignDailyTrends);
router.get('/:campaignId/post-engagement-snapshots/daily-by-url', authenticate, getPostDailyTrendByUrl);
router.get('/:campaignId/post-engagement-snapshots/daily/:submissionId', authenticate, getPostDailyTrend);
router.post('/:campaignId/post-engagement-snapshots/daily/capture', authenticate, isAdmin, triggerDailyCapture);

// BD campaign brief link endpoints
router.post('/:id/submit-for-review', authenticate, submitDraftForReview);
router.get('/drafts', authenticate, isBdOrSuperadmin, getDraftCampaigns);
router.delete('/:id/draft', authenticate, isBdOrSuperadmin, deleteDraftCampaign);
router.patch('/:id/unlink-company', authenticate, isBdOrSuperadmin, unlinkCampaignCompany);

export default router;

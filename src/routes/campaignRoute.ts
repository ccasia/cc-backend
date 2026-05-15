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
  // createLogistics,
  // getLogisticById,
  // updateStatusLogistic,
  // receiveLogistic,
  shortlistCreator,
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
// import { needPermissions } from '@middlewares/needPermissions';
import { createNewTemplate, getAllTemplate, getTemplatebyId } from '@controllers/templateController';

const router = Router();

// create isFinance permission later

// Agreement Template

router.get('/total', isSuperAdmin, getCampaignsTotal);

router.get('/template', isSuperAdmin, getAllTemplate);
router.get('/template/:id', getTemplatebyId);

router.get('/getAllCampaignsByAdminID', isSuperAdmin, getAllCampaigns);

router.get('/getCampaignById/:id', isSuperAdmin, getCampaignById);
router.get('/getClientByCampID/:id', getCampaignById);
// router.get('/getCampaignByIdInvoice/:id' , getCampaignById);
router.get('/getAllActiveCampaign', getAllActiveCampaign);
router.get('/getAllCampaignsFinance', getAllCampaignsFinance);
// router.get('/getCampaignById/:id', isSuperAdmin, getCampaignById);
router.get('/getAllActiveCampaign', getAllActiveCampaign);
router.get('/matchCampaignWithCreator', authenticate, matchCampaignWithCreator);
router.get('/pitch/:id', getPitchById);

// router.get('/firstDraft', getFirstDraft);
router.get('/timelineType', isSuperAdmin, getTimelineType);
router.get('/defaultTimeline', isSuperAdmin, getDefaultTimeline);
router.get('/getCampaignsBySessionId', authenticate, getCampaignsByCreatorId);
router.get('/getCampaignForCreatorById/:id', authenticate, getCampaignForCreatorById);
router.get('/getCampaignPitch', authenticate, getCampaignPitchForCreator);
// router.get('/getLogistics', isSuperAdmin, getLogisticById);
router.get('/getSubmissions', getSubmission);
// router.get('/pitch/:campaignId', getPitchByCampaignId);
router.get('/getCampaignLog/:id', getCampaignLog);
router.get('/creatorAgreements/:campaignId', creatorAgreements);

// For Analytics
router.get('/pitches', getAllPitches);
router.get('/getCreatorAgreements', isSuperAdmin, getAllCreatorAgreements);

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
router.post('/createCampaign', isSuperAdmin, createCampaign);
router.post('/createCampaignV2', isSuperAdmin, createCampaignV2);
router.post('/createNewTimeline', isSuperAdmin, createNewTimeline);
router.post('/createSingleTimelineType', isSuperAdmin, createSingleTimelineType);
router.post('/uploadVideo', uploadVideoTest);
router.post('/saveCampaign', authenticate, saveCampaign);
// router.post('/createLogistic', authenticate, createLogistics);
router.post('/shortlistCreator', isSuperAdmin, shortlistCreator);
router.post('/template/:id', isSuperAdmin, createNewTemplate);
router.post('/draftPitch', authenticate, draftPitch);
router.post('/spreadsheet', authenticate, isSuperAdmin, createNewSpreadSheets);
router.post('/export/active-completed', isSuperAdmin, exportActiveCompletedToSheet);
router.post('/export/campaign-creators', isSuperAdmin, exportCreatorsCampaignSheet);
router.post('/removeCreatorFromCampaign', authenticate, isSuperAdmin, removeCreatorFromCampaign);
router.post('/v2/shortlistCreator', isSuperAdmin, shortlistCreatorV2);
router.post('/v2/shortlistCreator/client', isSuperAdmin, shortlistCreatorV2ForClient);
router.post('/v3/shortlistCreator', authenticate, shortlistCreatorV3);
router.post('/v3/shortlistCreator/guest', authenticate, shortlistGuestCreators);
router.post('/v3/assignUGCCredits', authenticate, assignUGCCreditsV3);

router.patch('/v4/changeCredits', authenticate, isSuperAdmin, changeCampaignCredit);

// Credit management routes
router.post('/syncCredits/:campaignId', authenticate, syncCampaignCredits);
router.patch('/updateAllCredits', authenticate, isSuperAdmin, updateAllCampaignCredits);

router.patch('/pitch', authenticate, creatorMakePitch);
router.patch('/changeCampaignStage/:campaignId', changeCampaignStage);
router.patch('/closeCampaign/:id', isSuperAdmin, closeCampaign);
router.patch('/editCampaignInfo', isBdOrSuperadmin, editCampaignInfo);
router.patch('/editCampaignObjectives', isBdOrSuperadmin, editCampaignObjectives);
router.patch('/editCampaignBrandOrCompany', isBdOrSuperadmin, editCampaignBrandOrCompany);
router.patch('/editCampaignDosAndDonts', isSuperAdmin, editCampaignDosAndDonts);
router.patch('/editCampaignRequirements', isBdOrSuperadmin, editCampaignRequirements);
router.patch('/editCampaignLogistics', isSuperAdmin, editCampaignLogistics);
router.patch('/editCampaignFinalise', isSuperAdmin, editCampaignFinalise);
router.patch('/editCampaignAdditionalDetails', isSuperAdmin, editCampaignAdditionalDetails);
router.patch('/editCampaignTimeline/:id', isSuperAdmin, editCampaignTimeline);
router.patch('/editCampaignImages/:id', isSuperAdmin, editCampaignImages);
router.patch('/editCampaignAdmins/:id', isSuperAdmin, editCampaignAdmin);
router.patch('/editCampaignAttachments/:id', isSuperAdmin, editCampaignAttachments);
router.patch('/editCampaignReference/:id', isSuperAdmin, editCampaignReference);
router.patch('/changePitchStatus', isSuperAdmin, changePitchStatus);
// router.patch('/changeLogisticStatus', isSuperAdmin, updateStatusLogistic); //need permission later
// router.patch('/receiveLogistic', authenticate, receiveLogistic);
router.patch('/updateAmountAgreement', authenticate, isSuperAdmin, updateAmountAgreement);
router.patch('/sendAgreement', authenticate, isSuperAdmin, sendAgreement);
router.patch('/resendAgreement', authenticate, resendAgreement);
router.patch('/removePitchVideo', authenticate, removePitchVideo);
router.patch('/linkNewAgreement', authenticate, isSuperAdmin, linkNewAgreement);
router.patch('/changeCredits', authenticate, isSuperAdmin, changeCampaignCredit);

router.delete('/timelineType/:id', isSuperAdmin, deleteTimelineType);
router.delete('/unsaveCampaign/:id', authenticate, unSaveCampaign);

// Client campaign activation by CSM
router.post('/activateClientCampaign/:campaignId', canActivateCampaign, activateClientCampaign);
router.post('/initialActivateCampaign/:campaignId', canActivateCampaign, initialActivateCampaign);

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

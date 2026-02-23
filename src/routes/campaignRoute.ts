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
} from '@controllers/campaignController';
import {
  swapGuestWithPlatformCreator,
  cleanupOrphanedGuestUsers,
  getGuestCreatorsForCampaign,
} from '@controllers/swapCreatorController';
import { getPCRData, savePCRData } from '@controllers/pcrController';
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
} from '@controllers/postEngagementSnapshotController';
import { isSuperAdmin, isAdmin } from '@middlewares/onlySuperadmin';
import { canActivateCampaign } from '@middlewares/adminOrClient';

import {
  createNewTimeline,
  createSingleTimelineType,
  deleteTimelineType,
  getDefaultTimeline,
  getTimelineType,
  updateOrCreateDefaultTimeline,
} from '@controllers/timelineController';
import { isLoggedIn } from '@middlewares/onlyLogin';
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
router.get('/matchCampaignWithCreator', isLoggedIn, matchCampaignWithCreator);
router.get('/pitch/:id', getPitchById);

// router.get('/firstDraft', getFirstDraft);
router.get('/timelineType', isSuperAdmin, getTimelineType);
router.get('/defaultTimeline', isSuperAdmin, getDefaultTimeline);
router.get('/getCampaignsBySessionId', isLoggedIn, getCampaignsByCreatorId);
router.get('/getCampaignForCreatorById/:id', isLoggedIn, getCampaignForCreatorById);
router.get('/getCampaignPitch', isLoggedIn, getCampaignPitchForCreator);
// router.get('/getLogistics', isSuperAdmin, getLogisticById);
router.get('/getSubmissions', getSubmission);
// router.get('/pitch/:campaignId', getPitchByCampaignId);
router.get('/getCampaignLog/:id', getCampaignLog);
router.get('/creatorAgreements/:campaignId', creatorAgreements);

// For Analytics
router.get('/pitches', getAllPitches);
router.get('/getCreatorAgreements', isSuperAdmin, getAllCreatorAgreements);

// For creator MyCampaigns
router.get('/getMyCampaigns/:userId', isLoggedIn, getMyCampaigns);

// Get Campaigns by Admin ID
router.get('/getAllCampaignsByAdminId/:userId', getAllCampaignsByAdminId);

router.get('/campaignStatus', isLoggedIn, getCampaignStatus);

// Get Campaigns for Client users
router.get('/getClientCampaigns', isLoggedIn, getClientCampaigns);

// Debug endpoint to check campaign admin entries
router.get('/checkCampaignAdmin', isLoggedIn, checkCampaignAdmin);

// Debug endpoint to update campaign origin for testing
router.post('/updateCampaignOrigin', isLoggedIn, updateCampaignOrigin);

// Debug endpoint to add client to campaign admin for all company campaigns
router.post('/addClientToCampaignAdmin', isLoggedIn, addClientToCampaignAdmin);

// Fix campaign timelines for creator discovery
router.post('/fixCampaignTimelines/:campaignId', isLoggedIn, fixCampaignTimelines);

// Check if a campaign meets all requirements to be visible to creators
router.get('/checkCreatorVisibility/:campaignId', isLoggedIn, checkCampaignCreatorVisibility);

router.get('/public', getCampaignsForPublic);

// Swap Creator endpoints
router.get('/:campaignId/guestCreators', isLoggedIn, getGuestCreatorsForCampaign);
router.post('/swapCreator', isLoggedIn, isSuperAdmin, swapGuestWithPlatformCreator);
router.post('/cleanupGuestCreators', isLoggedIn, isSuperAdmin, cleanupOrphanedGuestUsers);

// Get Campaigns for Client users
router.get('/getClientCampaigns', isLoggedIn, getClientCampaigns);

// Debug endpoint to check campaign admin entries
router.get('/checkCampaignAdmin', isLoggedIn, checkCampaignAdmin);

// Debug endpoint to update campaign origin for testing
router.post('/updateCampaignOrigin', isLoggedIn, updateCampaignOrigin);

// Debug endpoint to add client to campaign admin for all company campaigns
router.post('/addClientToCampaignAdmin', isLoggedIn, addClientToCampaignAdmin);

// Fix campaign timelines for creator discovery
router.post('/fixCampaignTimelines/:campaignId', isLoggedIn, fixCampaignTimelines);

// Check if a campaign meets all requirements to be visible to creators
router.get('/checkCreatorVisibility/:campaignId', isLoggedIn, checkCampaignCreatorVisibility);

router.get('/public', getCampaignsForPublic);

router.post('/updateOrCreateDefaultTimeline', updateOrCreateDefaultTimeline);
router.post('/createCampaign', isSuperAdmin, createCampaign);
router.post('/createCampaignV2', isSuperAdmin, createCampaignV2);
router.post('/createNewTimeline', isSuperAdmin, createNewTimeline);
router.post('/createSingleTimelineType', isSuperAdmin, createSingleTimelineType);
router.post('/uploadVideo', uploadVideoTest);
router.post('/saveCampaign', isLoggedIn, saveCampaign);
// router.post('/createLogistic', isLoggedIn, createLogistics);
router.post('/shortlistCreator', isSuperAdmin, shortlistCreator);
router.post('/template/:id', isSuperAdmin, createNewTemplate);
router.post('/draftPitch', isLoggedIn, draftPitch);
router.post('/spreadsheet', isLoggedIn, isSuperAdmin, createNewSpreadSheets);
router.post('/export/active-completed', isSuperAdmin, exportActiveCompletedToSheet);
router.post('/export/campaign-creators', isSuperAdmin, exportCreatorsCampaignSheet);
router.post('/removeCreatorFromCampaign', isLoggedIn, isSuperAdmin, removeCreatorFromCampaign);
router.post('/v2/shortlistCreator', isSuperAdmin, shortlistCreatorV2);
router.post('/v2/shortlistCreator/client', isSuperAdmin, shortlistCreatorV2ForClient);
router.post('/v3/shortlistCreator', isLoggedIn, shortlistCreatorV3);
router.post('/v3/shortlistCreator/guest', isLoggedIn, shortlistGuestCreators);
router.post('/v3/assignUGCCredits', isLoggedIn, assignUGCCreditsV3);

router.patch('/v4/changeCredits', isLoggedIn, isSuperAdmin, changeCampaignCredit);

// Credit management routes
router.post('/syncCredits/:campaignId', isLoggedIn, syncCampaignCredits);
router.patch('/updateAllCredits', isLoggedIn, isSuperAdmin, updateAllCampaignCredits);

router.patch('/pitch', isLoggedIn, creatorMakePitch);
router.patch('/changeCampaignStage/:campaignId', changeCampaignStage);
router.patch('/closeCampaign/:id', isSuperAdmin, closeCampaign);
router.patch('/editCampaignInfo', isSuperAdmin, editCampaignInfo);
router.patch('/editCampaignObjectives', isSuperAdmin, editCampaignObjectives);
router.patch('/editCampaignBrandOrCompany', isSuperAdmin, editCampaignBrandOrCompany);
router.patch('/editCampaignDosAndDonts', isSuperAdmin, editCampaignDosAndDonts);
router.patch('/editCampaignRequirements', isSuperAdmin, editCampaignRequirements);
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
// router.patch('/receiveLogistic', isLoggedIn, receiveLogistic);
router.patch('/updateAmountAgreement', isLoggedIn, isSuperAdmin, updateAmountAgreement);
router.patch('/sendAgreement', isLoggedIn, isSuperAdmin, sendAgreement);
router.patch('/resendAgreement', isLoggedIn, resendAgreement);
router.patch('/removePitchVideo', isLoggedIn, removePitchVideo);
router.patch('/linkNewAgreement', isLoggedIn, isSuperAdmin, linkNewAgreement);
router.patch('/changeCredits', isLoggedIn, isSuperAdmin, changeCampaignCredit);

router.delete('/timelineType/:id', isSuperAdmin, deleteTimelineType);
router.delete('/unsaveCampaign/:id', isLoggedIn, unSaveCampaign);

// Client campaign activation by CSM
router.post('/activateClientCampaign/:campaignId', canActivateCampaign, activateClientCampaign);
router.post('/initialActivateCampaign/:campaignId', canActivateCampaign, initialActivateCampaign);

// Campaign Trends Analytics endpoints
router.get('/:campaignId/trends/engagement-heatmap', isLoggedIn, getEngagementHeatmapController);
router.get('/:campaignId/trends/top-creators', getTopCreatorsTrendController);
router.get('/:campaignId/trends/summary', isLoggedIn, getTrendsSummaryController);
router.post('/:campaignId/trends/refresh', isLoggedIn, isSuperAdmin, refreshCampaignInsightsController);

// PCR (Post Campaign Report) endpoints
router.get('/:campaignId/pcr', isLoggedIn, getPCRData);
router.post('/:campaignId/pcr', isLoggedIn, savePCRData);

// Manual Creator Entry endpoints (for campaign analytics)
router.post('/:campaignId/manual-creator', isLoggedIn, isAdmin, createManualCreator);
router.get('/:campaignId/manual-creators', isLoggedIn, getManualCreators);
router.put('/:campaignId/manual-creator/:entryId', isLoggedIn, isAdmin, updateManualCreator);
router.delete('/:campaignId/manual-creator/:entryId', isLoggedIn, isAdmin, deleteManualCreator);

// Post Engagement Snapshot endpoints (Day 7, 15, 30 ER tracking)
router.get('/:campaignId/post-engagement-snapshots', isLoggedIn, getCampaignPostSnapshots);
router.post('/:campaignId/post-engagement-snapshots/capture', isLoggedIn, isAdmin, triggerManualSnapshot);

export default router;

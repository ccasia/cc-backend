import { Router } from 'express';
import {
  createCampaign,
  getAllCampaigns,
  getCampaignById,
  getAllActiveCampaign,
  creatorMakePitch,
  changeCampaignStage,
  closeCampaign,
  getPitchById,
  editCampaignInfo,
  editCampaignBrandOrCompany,
  editCampaignDosAndDonts,
  editCampaignRequirements,
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
  createLogistics,
  getLogisticById,
  updateStatusLogistic,
  shortlistCreator,
  receiveLogistic,
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
  getAllPitches,
  getAllCreatorAgreements,
  changeCampaignCredit,
  exportActiveCompletedToSheet,
  exportCreatorsCampaignSheet,
  getCampaignsForPublic,
} from '@controllers/campaignController';
import { isSuperAdmin } from '@middlewares/onlySuperadmin';

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
router.get('/getLogistics', isSuperAdmin, getLogisticById);
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

router.get('/public', getCampaignsForPublic);

router.post('/updateOrCreateDefaultTimeline', updateOrCreateDefaultTimeline);
router.post('/createCampaign', isSuperAdmin, createCampaign);
router.post('/createNewTimeline', isSuperAdmin, createNewTimeline);
router.post('/createSingleTimelineType', isSuperAdmin, createSingleTimelineType);
router.post('/uploadVideo', uploadVideoTest);
router.post('/saveCampaign', isLoggedIn, saveCampaign);
router.post('/createLogistic', isLoggedIn, createLogistics);
router.post('/shortlistCreator', isSuperAdmin, shortlistCreator);
router.post('/template/:id', isSuperAdmin, createNewTemplate);
router.post('/draftPitch', isLoggedIn, draftPitch);
router.post('/spreadsheet', isLoggedIn, isSuperAdmin, createNewSpreadSheets);
router.post('/export/active-completed', isSuperAdmin, exportActiveCompletedToSheet);
router.post('/export/campaign-creators', isSuperAdmin, exportCreatorsCampaignSheet);
router.post('/removeCreatorFromCampaign', isLoggedIn, isSuperAdmin, removeCreatorFromCampaign);
router.post('/v2/shortlistCreator', isSuperAdmin, shortlistCreatorV2);

router.patch('/pitch', isLoggedIn, creatorMakePitch);
router.patch('/changeCampaignStage/:campaignId', changeCampaignStage);
router.patch('/closeCampaign/:id', isSuperAdmin, closeCampaign);
router.patch('/editCampaignInfo', isSuperAdmin, editCampaignInfo);
router.patch('/editCampaignBrandOrCompany', isSuperAdmin, editCampaignBrandOrCompany);
router.patch('/editCampaignDosAndDonts', isSuperAdmin, editCampaignDosAndDonts);
router.patch('/editCampaignRequirements', isSuperAdmin, editCampaignRequirements);
router.patch('/editCampaignTimeline/:id', isSuperAdmin, editCampaignTimeline);
router.patch('/editCampaignImages/:id', isSuperAdmin, editCampaignImages);
router.patch('/editCampaignAdmins/:id', isSuperAdmin, editCampaignAdmin);
router.patch('/editCampaignAttachments/:id', isSuperAdmin, editCampaignAttachments);
router.patch('/editCampaignReference/:id', isSuperAdmin, editCampaignReference);
router.patch('/changePitchStatus', isSuperAdmin, changePitchStatus);
router.patch('/changeLogisticStatus', isSuperAdmin, updateStatusLogistic); //need permission later
router.patch('/receiveLogistic', isLoggedIn, receiveLogistic);
router.patch('/updateAmountAgreement', isLoggedIn, isSuperAdmin, updateAmountAgreement);
router.patch('/sendAgreement', isLoggedIn, isSuperAdmin, sendAgreement);
router.patch('/resendAgreement', isLoggedIn, resendAgreement);
router.patch('/removePitchVideo', isLoggedIn, removePitchVideo);
router.patch('/linkNewAgreement', isLoggedIn, isSuperAdmin, linkNewAgreement);
router.patch('/changeCredits', isLoggedIn, changeCampaignCredit);

router.delete('/timelineType/:id', isSuperAdmin, deleteTimelineType);
router.delete('/unsaveCampaign/:id', isLoggedIn, unSaveCampaign);

export default router;

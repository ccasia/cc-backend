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
  getFirstDraft,
  changePitchStatus,
  getCampaignsByCreatorId,
  getCampaignForCreatorById,
  getCampaignPitchForCreator,
  // editRequirement,
  // editDosandDonts,
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
} from './controller/campaignController';
import { isSuperAdmin } from './middleware/onlySuperadmin';
import {
  createNewTimeline,
  createSingleTimelineType,
  deleteTimelineType,
  getDefaultTimeline,
  getTimelineType,
  updateOrCreateDefaultTimeline,
} from './controller/timelineController';
import { isLoggedIn } from './middleware/onlyLogin';
import { needPermissions } from './middleware/needPermissions';

const router = Router();

// create isFinance permission later

router.get('/getAllCampaignsByAdminID', isSuperAdmin, getAllCampaigns);

router.get('/getCampaignById/:id', isSuperAdmin, getCampaignById);
router.get('/getClientByCampID/:id', getCampaignById);
// router.get('/getCampaignByIdInvoice/:id' , getCampaignById);
router.get('/getAllActiveCampaign', getAllActiveCampaign);
router.get('/getAllCampaignsFinance', getAllCampaignsFinance);
router.get('/getCampaignById/:id', isSuperAdmin, getCampaignById);
router.get('/getAllActiveCampaign', getAllActiveCampaign);
router.get('/matchCampaignWithCreator', isLoggedIn, matchCampaignWithCreator);
router.get('/pitch/:id', getPitchById);
router.get('/firstDraft', getFirstDraft);
router.get('/timelineType', isSuperAdmin, getTimelineType);
router.get('/defaultTimeline', isSuperAdmin, getDefaultTimeline);
router.get('/getCampaignsBySessionId', getCampaignsByCreatorId);
router.get('/getCampaignForCreatorById/:id', isLoggedIn, getCampaignForCreatorById);
router.get('/getCampaignPitch', isLoggedIn, getCampaignPitchForCreator);
router.get('/getLogistics', isSuperAdmin, getLogisticById);

router.get('/getSubmissions', isSuperAdmin, getSubmission);
// router.get('/pitch/:campaignId', getPitchByCampaignId);
router.get('/getCampaignLog/:id', getCampaignLog);

router.post('/updateOrCreateDefaultTimeline', updateOrCreateDefaultTimeline);
router.post('/createCampaign', isSuperAdmin, createCampaign);
// router.post('/rejectPitch', isSuperAdmin, rejectPitch);
router.post('/createNewTimeline', isSuperAdmin, createNewTimeline);
router.post('/createSingleTimelineType', isSuperAdmin, createSingleTimelineType);
router.post(
  '/uploadVideo',

  uploadVideoTest,
);
router.post('/saveCampaign', isLoggedIn, isSuperAdmin, saveCampaign);
router.post('/createLogistic', isLoggedIn, createLogistics);
router.post('/shortlistCreator', isSuperAdmin, shortlistCreator);

router.patch('/pitch', creatorMakePitch);
router.patch('/changeCampaignStage/:campaignId', changeCampaignStage);
router.patch('/closeCampaign/:id', isSuperAdmin, closeCampaign);
router.patch('/editCampaignInfo', isSuperAdmin, editCampaignInfo);
router.patch('/editCampaignBrandOrCompany', isSuperAdmin, editCampaignBrandOrCompany);
router.patch('/editCampaignDosAndDonts', isSuperAdmin, editCampaignDosAndDonts);
router.patch('/editCampaignRequirements', isSuperAdmin, editCampaignRequirements);
router.patch('/editCampaignTimeline/:id', isSuperAdmin, editCampaignTimeline);
router.patch('/changePitchStatus', changePitchStatus);
router.patch('/changeLogisticStatus', isSuperAdmin, updateStatusLogistic); //need permission later
router.patch('/receiveLogistic', isLoggedIn, receiveLogistic);

router.delete('/timelineType/:id', isSuperAdmin, deleteTimelineType);
router.delete('/unsaveCampaign/:id', isLoggedIn, unSaveCampaign);

export default router;

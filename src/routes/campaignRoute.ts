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
  saveCampaign,
  unSaveCampaign,
  createLogistics,
  getLogisticById,
  updateStatusLogistic,
  shortlistCreator,
} from 'src/controller/campaignController';
import { isSuperAdmin } from 'src/middleware/onlySuperadmin';
import {
  createNewTimeline,
  createSingleTimelineType,
  deleteTimelineType,
  getDefaultTimeline,
  getTimelineType,
  updateOrCreateDefaultTimeline,
} from 'src/controller/timelineController';
import { isLoggedIn } from 'src/middleware/onlyLogin';
import { needPermissions } from 'src/middleware/needPermissions';

const router = Router();

router.get('/getAllCampaignsByAdminID', needPermissions(['list:campaign']), isSuperAdmin, getAllCampaigns);
router.get('/getCampaignById/:id', needPermissions(['view:campaign']), isSuperAdmin, getCampaignById);

router.get('/getAllActiveCampaign', needPermissions(['list:campaign']), getAllActiveCampaign);
router.get('/matchCampaignWithCreator', matchCampaignWithCreator);
router.get('/pitch/:id', needPermissions(['view:campaign']), getPitchById);
router.get('/firstDraft', needPermissions(['list:campaign']), getFirstDraft);
router.get('/timelineType', needPermissions(['list:campaign']), isSuperAdmin, getTimelineType);
router.get('/defaultTimeline', isSuperAdmin, getDefaultTimeline);
router.get('/getCampaignsBySessionId', getCampaignsByCreatorId);
router.get('/getCampaignForCreatorById/:id', isLoggedIn, getCampaignForCreatorById);
router.get('/getCampaignPitch', isLoggedIn, getCampaignPitchForCreator);
router.get('/getLogistics', isSuperAdmin, getLogisticById);

router.get('/getSubmissions', needPermissions(['list:campaign']), isSuperAdmin, getSubmission);
// router.get('/pitch/:campaignId', getPitchByCampaignId);
router.get('/getCampaignLog/:id', needPermissions(['view:campaign']), getCampaignLog);

router.post('/updateOrCreateDefaultTimeline', needPermissions(['create:campaign']), updateOrCreateDefaultTimeline);
router.post('/createCampaign', needPermissions(['create:campaign']), isSuperAdmin, createCampaign);
// router.post('/rejectPitch', isSuperAdmin, rejectPitch);
router.post('/createNewTimeline', needPermissions(['create:campaign']), isSuperAdmin, createNewTimeline);
router.post('/createSingleTimelineType', needPermissions(['create:campaign']), isSuperAdmin, createSingleTimelineType);
router.post(
  '/uploadVideo',
  // (req, res, next) => {
  //   req.on('close', () => {
  //     console.log('ABORTINGGG');
  //   });
  //   next();
  // },
  uploadVideoTest,
);
router.post('/saveCampaign', isLoggedIn, saveCampaign);
router.post('/createLogistic', needPermissions(['view_creator', 'list_creator']), createLogistics);
router.post('/shortlistCreator', isSuperAdmin, shortlistCreator);

router.patch('/pitch', creatorMakePitch);
router.patch('/changeCampaignStage/:campaignId', needPermissions(['update:campaign']), changeCampaignStage);
router.patch('/closeCampaign/:id', needPermissions(['update:campaign']), isSuperAdmin, closeCampaign);
router.patch('/editCampaignInfo', needPermissions(['update:campaign']), isSuperAdmin, editCampaignInfo);
router.patch(
  '/editCampaignBrandOrCompany',
  needPermissions(['update:campaign']),
  isSuperAdmin,
  editCampaignBrandOrCompany,
);
router.patch('/editCampaignDosAndDonts', needPermissions(['update:campaign']), isSuperAdmin, editCampaignDosAndDonts);
router.patch('/editCampaignRequirements', needPermissions(['update:campaign']), isSuperAdmin, editCampaignRequirements);
router.patch('/editCampaignTimeline/:id', needPermissions(['update:campaign']), isSuperAdmin, editCampaignTimeline);
router.patch('/changePitchStatus', needPermissions(['update:campaign']), changePitchStatus);
router.patch('/changeLogisticStatus', isSuperAdmin, updateStatusLogistic); //need permission later

router.delete('/timelineType/:id', needPermissions(['delete:campaign']), isSuperAdmin, deleteTimelineType);
router.delete('/unsaveCampaign/:id', isLoggedIn, unSaveCampaign);

export default router;

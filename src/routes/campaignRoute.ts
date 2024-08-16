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
router.get('/matchCampaignWithCreator', needPermissions(['list:campaign']), matchCampaignWithCreator);
router.get('/pitch/:id', needPermissions(['view:campaign']), getPitchById);
router.get('/firstDraft', needPermissions(['list:campaign']), getFirstDraft);
router.get('/timelineType', needPermissions(['list:campaign']), isSuperAdmin, getTimelineType);
router.get('/defaultTimeline', needPermissions(['list:campaign']), isSuperAdmin, getDefaultTimeline);
router.get('/getCampaignsBySessionId', needPermissions(['list:campaign']), getCampaignsByCreatorId);
router.get('/getCampaignForCreatorById/:id', needPermissions(['view:campaign']), isLoggedIn, getCampaignForCreatorById);
router.get('/getCampaignPitch', needPermissions(['list:campaign']), isLoggedIn, getCampaignPitchForCreator);

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
  needPermissions(['create:campaign']),
  uploadVideoTest,
);

router.patch('/pitch', needPermissions(['update:campaign']), creatorMakePitch);
router.patch('/changeCampaignStage/:campaignId', needPermissions(['update:campaign']), changeCampaignStage);
router.patch('/closeCampaign/:id', needPermissions(['update:campaign']), isSuperAdmin, closeCampaign);
router.patch('/editCampaignInfo', needPermissions(['update:campaign']), isSuperAdmin, editCampaignInfo);
router.patch('/editCampaignBrandOrCompany', needPermissions(['update:campaign']), isSuperAdmin, editCampaignBrandOrCompany);
router.patch('/editCampaignDosAndDonts', needPermissions(['update:campaign']), isSuperAdmin, editCampaignDosAndDonts);
router.patch('/editCampaignRequirements', needPermissions(['update:campaign']), isSuperAdmin, editCampaignRequirements);
router.patch('/editCampaignTimeline/:id', needPermissions(['update:campaign']), isSuperAdmin, editCampaignTimeline);
router.patch('/changePitchStatus', needPermissions(['update:campaign']), changePitchStatus);

router.delete('/timelineType/:id', needPermissions(['delete:campaign']), isSuperAdmin, deleteTimelineType);

export default router;

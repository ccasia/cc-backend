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
  editRequirement,
  editDosandDonts,
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

const router = Router();

// router.get('/defaultTimeline', async (_req: Request, res: Response) => {
//   try {
//     const defaults = await prisma.defaultTimelineCampaign.findMany();
//     return res.status(200).send(defaults);
//   } catch (error) {
//     return res.status(400).json({ error });
//   }
// });

router.get('/getAllCampaignsByAdminID', isSuperAdmin, getAllCampaigns);
router.get('/getCampaignById/:id', isSuperAdmin, getCampaignById);
router.get('/getAllActiveCampaign', getAllActiveCampaign);
router.get('/matchCampaignWithCreator', matchCampaignWithCreator);
router.get('/pitch/:id', getPitchById);
router.get('/firstDraft', getFirstDraft);
router.get('/timelineType', isSuperAdmin, getTimelineType);
router.get('/defaultTimeline', isSuperAdmin, getDefaultTimeline);
router.get('/getCampaignsBySessionId', getCampaignsByCreatorId);
router.get('/getCampaignForCreatorById/:id', isLoggedIn, getCampaignForCreatorById);
router.get('/getCampaignPitch', isLoggedIn, getCampaignPitchForCreator);

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
  // (req, res, next) => {
  //   req.on('close', () => {
  //     console.log('ABORTINGGG');
  //   });
  //   next();
  // },
  uploadVideoTest,
);

router.patch('/pitch', creatorMakePitch);
router.patch('/changeCampaignStage/:campaignId', changeCampaignStage);
router.patch('/closeCampaign/:id', isSuperAdmin, closeCampaign);
router.patch('/editCampaignInfo', isSuperAdmin, editCampaignInfo);
router.patch('/editCampaignBrandOrCompany', isSuperAdmin, editCampaignBrandOrCompany);
router.patch('/editCampaignDosAndDonts', isSuperAdmin, editCampaignDosAndDonts);
router.patch('/editCampaignRequirements', isSuperAdmin, editCampaignRequirements);
router.patch('/editCampaignTimeline/:id', isSuperAdmin, editCampaignTimeline);
router.patch('/changePitchStatus', changePitchStatus);

router.delete('/timelineType/:id', isSuperAdmin, deleteTimelineType);

export default router;

import { Response, Router, Request } from 'express';
import { PrismaClient } from '@prisma/client';
import {
  updateDefaultTimeline,
  createCampaign,
  getAllCampaigns,
  getCampaignById,
  getAllActiveCampaign,
  creatorMakePitch,
  changeCampaignStage,
  closeCampaign,
  getPitchById,
  // rejectPitch,
  editCampaignInfo,
  editCampaignBrandOrCompany,
  // updateTimeLineType,
  updateCampaignTimeline,
  getFirstDraft,
  changePitchStatus,
  getCampaignsByCreatorId,
  getCampaignForCreatorById,
  getCampaignPitchForCreator,
  editRequirement,
  editDosandDonts,
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
router.get('/pitch/:id', getPitchById);
router.get('/firstDraft', getFirstDraft);
router.get('/timelineType', isSuperAdmin, getTimelineType);
router.get('/defaultTimeline', isSuperAdmin, getDefaultTimeline);
router.get('/getCampaignsBySessionId', getCampaignsByCreatorId);
router.get('/getCampaignForCreatorById/:id', isLoggedIn, getCampaignForCreatorById);
router.get('/getCampaignPitch', isLoggedIn, getCampaignPitchForCreator);
// router.get('/pitch/:campaignId', getPitchByCampaignId);

router.post('/updateOrCreateDefaultTimeline', updateOrCreateDefaultTimeline);
router.post('/updateDefaultTimeline', updateDefaultTimeline);
router.post('/createCampaign', isSuperAdmin, createCampaign);
// router.post('/rejectPitch', isSuperAdmin, rejectPitch);
router.post('/createNewTimeline', isSuperAdmin, createNewTimeline);
router.post('/createSingleTimelineType', isSuperAdmin, createSingleTimelineType);

router.patch('/pitch', creatorMakePitch);
router.patch('/changeCampaignStage/:campaignId', changeCampaignStage);
router.patch('/closeCampaign/:id', isSuperAdmin, closeCampaign);
router.patch('/editCampaignInfo', isSuperAdmin, editCampaignInfo);
router.patch('/editCampaignBrandOrCompany', isSuperAdmin, editCampaignBrandOrCompany);
router.patch('/updateCampaignTimeline/:id', isSuperAdmin, updateCampaignTimeline);
router.patch('/changePitchStatus', changePitchStatus);
router.patch('/editRequirement', isSuperAdmin, editRequirement);
router.patch('/editDosandDonts', isSuperAdmin, editDosandDonts);

router.delete('/timelineType/:id', isSuperAdmin, deleteTimelineType);

export default router;

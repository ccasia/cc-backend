import { Response, Router, Request } from 'express';
import { PrismaClient } from '@prisma/client';
import {
  updateDefaultTimeline,
  createCampaign,
  getAllCampaigns,
  getCampaignById,
  getAllActiveCampaign,
  creatorMakePitch,
  approvePitch,
  changeCampaignStage,
  closeCampaign,
  getPitchById,
  // rejectPitch,
  editCampaignBrandOrCompany,
  // updateTimeLineType,
  updateCampaignTimeline,
  filterPitch,
  getFirstDraft,
  changePitchStatus,
  getCampaignsByCreatorId,
  getCampaignForCreatorById,
} from 'src/controller/campaignController';
import { isSuperAdmin } from 'src/middleware/onlySuperadmin';
import {
  createNewTimeline,
  getDefaultTimeline,
  getTimelineType,
  updateOrCreateDefaultTimeline,
} from 'src/controller/timelineController';
import { isLoggedIn } from 'src/middleware/onlyLogin';

const router = Router();
const prisma = new PrismaClient();

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
router.get('/firstDraft', isSuperAdmin, getFirstDraft);
router.get('/timelineType', isSuperAdmin, getTimelineType);
router.get('/defaultTimeline', isSuperAdmin, getDefaultTimeline);
router.get('/getCampaignsBySessionId', getCampaignsByCreatorId);
router.get('/getCampaignForCreatorById/:id', isLoggedIn, getCampaignForCreatorById);
// router.get('/pitch/:campaignId', getPitchByCampaignId);

router.post('/updateOrCreateDefaultTimeline', updateOrCreateDefaultTimeline);
router.post('/updateDefaultTimeline', updateDefaultTimeline);
router.post('/createCampaign', isSuperAdmin, createCampaign);
router.post('/approvePitch', isSuperAdmin, approvePitch);
// router.post('/rejectPitch', isSuperAdmin, rejectPitch);
router.post('/filterPitch', isSuperAdmin, filterPitch);
router.post('/createNewTimeline', isSuperAdmin, createNewTimeline);

router.patch('/pitch', creatorMakePitch);
router.patch('/changeCampaignStage/:campaignId', changeCampaignStage);
router.patch('/closeCampaign/:id', isSuperAdmin, closeCampaign);
router.patch('/editCampaignBrandOrCompany', isSuperAdmin, editCampaignBrandOrCompany);
router.patch('/updateCampaignTimeline/:id', isSuperAdmin, updateCampaignTimeline);
router.patch('/changePitchStatus', changePitchStatus);

export default router;

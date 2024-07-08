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
  rejectPitch,
  editCampaignBrandOrCompany,
  updateTimeLineType,
  updateCampaignTimeline,
  filterPitch,
} from 'src/controller/campaignController';
import { isSuperAdmin } from 'src/middleware/onlySuperadmin';

const router = Router();
const prisma = new PrismaClient();

router.get('/defaultTimeline', async (_req: Request, res: Response) => {
  try {
    const defaults = await prisma.defaultTimelineCampaign.findMany();
    return res.status(200).send(defaults);
  } catch (error) {
    return res.status(400).json({ error });
  }
});

router.get('/timelineType', async (_req: Request, res: Response) => {
  try {
    const timeline = await prisma.timelineType.findMany({
      include: {
        dependencies: {
          include: {
            dependsOnTimeline: true,
          },
        },
      },
    });
    return res.status(200).send(timeline);
  } catch (error) {
    return res.status(400).json({ error });
  }
});

router.get('/getAllCampaignsByAdminID', isSuperAdmin, getAllCampaigns);
router.get('/getCampaignById/:id', isSuperAdmin, getCampaignById);
router.get('/getAllActiveCampaign', getAllActiveCampaign);
router.get('/pitch/:id', getPitchById);
// router.get('/pitch/:campaignId', getPitchByCampaignId);

router.post('/updateTimeLineType', updateTimeLineType);
router.post('/updateDefaultTimeline', updateDefaultTimeline);
router.post('/createCampaign', isSuperAdmin, createCampaign);
router.post('/approvePitch', isSuperAdmin, approvePitch);
router.post('/rejectPitch', isSuperAdmin, rejectPitch);
router.post('/filterPitch', isSuperAdmin, filterPitch);

router.patch('/pitch', creatorMakePitch);
router.patch('/changeCampaignStage/:campaignId', changeCampaignStage);
router.patch('/closeCampaign/:id', isSuperAdmin, closeCampaign);
router.patch('/editCampaignBrandOrCompany', isSuperAdmin, editCampaignBrandOrCompany);
router.patch('/updateCampaignTimeline/:id', isSuperAdmin, updateCampaignTimeline);

// router.post('/test', async (req, res) => {
//   const test = req.files?.image;

//   try {
//     await uploadImage((test as any)?.tempFilePath as string);
//     return res.status(200).send('Done');
//   } catch (error) {
//     console.log(error);
//     return res.status(400).json(error);
//   }
// });

export default router;

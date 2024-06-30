import { Response, Router, Request } from 'express';
import { PrismaClient } from '@prisma/client';
// import dayjs from 'dayjs';
import {
  updateDefaultTimeline,
  createCampaign,
  getAllCampaigns,
  getCampaignById,
  getAllActiveCampaign,
  creatorMakePitch,
  approvePitch,
  changeCampaignStage,
} from 'src/controller/campaignController';
import { isSuperAdmin } from 'src/middleware/onlySuperadmin';

const router = Router();
const prisma = new PrismaClient();

router.get('/defaultTimeline', async (_req: Request, res: Response) => {
  try {
    const defaults = await prisma.defaultTimelineCampaign.findMany();
    return res.status(200).send(defaults);
  } catch (error) {
    console.log(error);
  }
});

router.get('/getAllCampaignsByAdminID', isSuperAdmin, getAllCampaigns);

router.get('/getCampaignById/:id', isSuperAdmin, getCampaignById);

router.get('/getAllActiveCampaign', getAllActiveCampaign);

router.post('/updateDefaultTimeline', updateDefaultTimeline);

router.post('/createCampaign', isSuperAdmin, createCampaign);

router.post('/approvePitch', isSuperAdmin, approvePitch);

router.patch('/pitch', creatorMakePitch);

router.patch('/changeCampaignStage/:campaignId', changeCampaignStage);

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

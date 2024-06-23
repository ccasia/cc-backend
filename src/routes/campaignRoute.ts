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

router.patch('/pitch', creatorMakePitch);

export default router;

import { Router } from 'express';

const router = Router();

import { generateCampaignAccess, validateCampaignPassword, regenerateCampaignPassword } from "@controllers/acessController";
import { getCampaignById } from '@controllers/campaignController';




router.post('/generate', generateCampaignAccess);
router.post('/validate', validateCampaignPassword);
router.post('/regenerate', regenerateCampaignPassword);
router.get('/details/:id', getCampaignById);




export default router;
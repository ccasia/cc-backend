import { Router } from 'express';

const router = Router();

import {
  generateCampaignAccess,
  validateCampaignPassword,
  regenerateCampaignPassword,
  publicSubmitFeedback,
} from '@controllers/acessController';
import { getCampaignById } from '@controllers/campaignController';

router.post('/generate', generateCampaignAccess);
router.post('/validate', validateCampaignPassword);
router.post('/regenerate', regenerateCampaignPassword);
router.get('/details/:id', getCampaignById);
router.patch('/client-feedback', publicSubmitFeedback);

export default router;

import { Router } from 'express';

import {
  createCampaignCreationDraft,
  deleteCampaignCreationDraft,
  getActiveCampaignCreationDraft,
  updateCampaignCreationDraft,
  uploadCampaignCreationDraftFile,
} from '@controllers/campaignCreationDraftController';
import { authenticate } from '@middlewares/authenticate';
import { isSuperAdmin } from '@middlewares/onlySuperadmin';

const router = Router();

router.use(authenticate, isSuperAdmin);
router.post('/', createCampaignCreationDraft);
router.get('/active', getActiveCampaignCreationDraft);
router.post('/:id/files', uploadCampaignCreationDraftFile);
router.put('/:id', updateCampaignCreationDraft);
router.delete('/:id', deleteCampaignCreationDraft);

export default router;

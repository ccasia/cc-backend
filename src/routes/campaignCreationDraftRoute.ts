import { Router } from 'express';

import {
  createCampaignCreationDraft,
  deleteCampaignCreationDraft,
  getCampaignCreationDraftById,
  getActiveCampaignCreationDraft,
  listCampaignCreationDraft,
  updateCampaignCreationDraft,
  uploadCampaignCreationDraftFile,
} from '@controllers/campaignCreationDraftController';
import { authenticate } from '@middlewares/authenticate';
import { isSuperAdmin } from '@middlewares/onlySuperadmin';

const router = Router();

router.use(authenticate, isSuperAdmin);
router.post('/', createCampaignCreationDraft);
router.get('/', listCampaignCreationDraft);
router.get('/active', getActiveCampaignCreationDraft);
router.post('/:id/files', uploadCampaignCreationDraftFile);
router.get('/:id', getCampaignCreationDraftById);
router.put('/:id', updateCampaignCreationDraft);
router.delete('/:id', deleteCampaignCreationDraft);

export default router;

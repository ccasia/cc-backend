import { Router } from 'express';
import {
  getAllDraftInfo,
  getFirstDraft,
  submitFeedBackFirstDraft,
  submitFinalDraft,
} from '@controllers/draftController';
import { submitFirstDraft } from '@controllers/draftController';
import { authenticate } from '@middlewares/authenticate';
import { isSuperAdmin } from '@middlewares/onlySuperadmin';

const router = Router();

router.get('/firstDraft/:id', authenticate, getFirstDraft);
router.get('/getAllDraftInfo/:campaignId', isSuperAdmin, getAllDraftInfo);

router.post('/firstDraft', authenticate, submitFirstDraft);
router.post('/finalDraft', authenticate, submitFinalDraft);

router.patch('/submitFeedBackFirstDraft', isSuperAdmin, submitFeedBackFirstDraft);

export default router;

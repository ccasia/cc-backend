import { Router } from 'express';
import {
  getAllDraftInfo,
  getFirstDraft,
  submitFeedBackFirstDraft,
  submitFinalDraft,
} from '@controllers/draftController';
import { submitFirstDraft } from '@controllers/draftController';
import { isLoggedIn } from '@middlewares/onlyLogin';
import { isSuperAdmin } from '@middlewares/onlySuperadmin';

const router = Router();

router.get('/firstDraft/:id', isLoggedIn, getFirstDraft);
router.get('/getAllDraftInfo/:campaignId', isSuperAdmin, getAllDraftInfo);

router.post('/firstDraft', isLoggedIn, submitFirstDraft);
router.post('/finalDraft', isLoggedIn, submitFinalDraft);

router.patch('/submitFeedBackFirstDraft', isSuperAdmin, submitFeedBackFirstDraft);

export default router;

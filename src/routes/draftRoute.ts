import { Router } from 'express';
import {
  getAllDraftInfo,
  getFirstDraft,
  submitFeedBackFirstDraft,
  submitFinalDraft,
} from './controller/draftController';
import { submitFirstDraft } from './controller/draftController';
import { isLoggedIn } from './middleware/onlyLogin';
import { isSuperAdmin } from './middleware/onlySuperadmin';

const router = Router();

router.get('/firstDraft/:id', isLoggedIn, getFirstDraft);
router.get('/getAllDraftInfo/:campaignId', isSuperAdmin, getAllDraftInfo);

router.post('/firstDraft', isLoggedIn, submitFirstDraft);
router.post('/finalDraft', isLoggedIn, submitFinalDraft);

router.patch('/submitFeedBackFirstDraft', isSuperAdmin, submitFeedBackFirstDraft);

export default router;

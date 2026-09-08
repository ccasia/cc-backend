import { Router } from 'express';
import {
  getAllDraftInfo,
  getFirstDraft,
  submitFeedBackFirstDraft,
  submitFinalDraft,
  submitFirstDraft,
} from './draft.controller';
import { authenticate } from '@middlewares/authenticate';
import { isSuperAdmin } from '@middlewares/onlySuperadmin';

const router = Router();

router.get('/firstDraft/:id', authenticate, getFirstDraft);
router.get('/getAllDraftInfo/:campaignId', isSuperAdmin, getAllDraftInfo);

router.post('/firstDraft', authenticate, submitFirstDraft);
router.post('/finalDraft', authenticate, submitFinalDraft);

router.patch('/submitFeedBackFirstDraft', authenticate, isSuperAdmin, submitFeedBackFirstDraft);

export default router;

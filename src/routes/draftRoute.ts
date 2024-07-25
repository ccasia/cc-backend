import { Router } from 'express';
import { getAllDraftInfo, getFirstDraft } from 'src/controller/draftController';
import { submitFirstDraft } from 'src/controller/draftController';
import { isLoggedIn } from 'src/middleware/onlyLogin';
import { isSuperAdmin } from 'src/middleware/onlySuperadmin';

const router = Router();

router.get('/firstDraft/:id', isLoggedIn, getFirstDraft);
router.get('/getAllDraftInfo/:campaignId', isSuperAdmin, getAllDraftInfo);

router.post('/firstDraft', isLoggedIn, submitFirstDraft);

export default router;

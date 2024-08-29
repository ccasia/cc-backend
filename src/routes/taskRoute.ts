import { Router } from 'express';

import { creatorUploadAgreement } from '@controllers/tasksController';

import { isLoggedIn } from '@middlewares/onlyLogin';

const router = Router();

// router.get('/submissions', isLoggedIn, getSubmissionByCampaignCreatorId);
router.post('/uploadAgreementForm', isLoggedIn, creatorUploadAgreement);
// router.patch('/adminManageAgreementSubmission', isSuperAdmin, adminManageAgreementSubmission);

export default router;

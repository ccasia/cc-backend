import { Router } from 'express';

import { creatorUploadAgreement } from './controller/tasksController';

import { isLoggedIn } from './middleware/onlyLogin';

const router = Router();

// router.get('/submissions', isLoggedIn, getSubmissionByCampaignCreatorId);
router.post('/uploadAgreementForm', isLoggedIn, creatorUploadAgreement);
// router.patch('/adminManageAgreementSubmission', isSuperAdmin, adminManageAgreementSubmission);

export default router;

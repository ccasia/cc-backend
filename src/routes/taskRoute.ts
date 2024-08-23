import { Router } from 'express';

import { creatorUploadAgreement } from 'src/controller/tasksController';

import { isLoggedIn } from 'src/middleware/onlyLogin';

const router = Router();

// router.get('/submissions', isLoggedIn, getSubmissionByCampaignCreatorId);
router.post('/uploadAgreementForm', isLoggedIn, creatorUploadAgreement);
// router.patch('/adminManageAgreementSubmission', isSuperAdmin, adminManageAgreementSubmission);

export default router;

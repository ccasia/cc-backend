import { Router } from 'express';

import { creatorUploadAgreement } from '@controllers/tasksController';

import { authenticate } from '@middlewares/authenticate';

const router = Router();

// router.get('/submissions', authenticate, getSubmissionByCampaignCreatorId);
router.post('/uploadAgreementForm', authenticate, creatorUploadAgreement);
// router.patch('/adminManageAgreementSubmission', isSuperAdmin, adminManageAgreementSubmission);

export default router;

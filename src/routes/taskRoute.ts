import { Router } from 'express';
import {
  adminManageAgreementSubmission,
  creatorUploadAgreement,
  getSubmissionByCampaignCreatorId,
} from 'src/controller/tasksController';

import { isLoggedIn } from 'src/middleware/onlyLogin';
import { isSuperAdmin } from 'src/middleware/onlySuperadmin';

const router = Router();

router.get('/submissions', isLoggedIn, getSubmissionByCampaignCreatorId);
router.post('/uploadAgreementForm', isLoggedIn, creatorUploadAgreement);
router.patch('/adminManageAgreementSubmission', isSuperAdmin, adminManageAgreementSubmission);

export default router;

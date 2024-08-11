import { Router } from 'express';
import {
  adminManageAgreementSubmission,
  adminManageDraft,
  agreementSubmission,
  draftSubmission,
} from 'src/controller/submissionController';
import { isLoggedIn } from 'src/middleware/onlyLogin';
import { isSuperAdmin } from 'src/middleware/onlySuperadmin';

const router = Router();

router.post('/submitAgreement', isLoggedIn, agreementSubmission);
router.post('/draftSubmission', isLoggedIn, draftSubmission);

router.patch('/adminManageAgreementSubmission', isSuperAdmin, adminManageAgreementSubmission);
router.patch('/adminManageDraft', isSuperAdmin, adminManageDraft);

export default router;

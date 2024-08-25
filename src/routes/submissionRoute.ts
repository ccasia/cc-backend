import { Router } from 'express';
import {
  adminManageAgreementSubmission,
  adminManageDraft,
  adminManagePosting,
  agreementSubmission,
  draftSubmission,
  getSubmissionByCampaignCreatorId,
  postingSubmission,
} from 'src/controller/submissionController';
import { isLoggedIn } from 'src/middleware/onlyLogin';
import { isSuperAdmin } from 'src/middleware/onlySuperadmin';

const router = Router();

router.get('/', isLoggedIn, getSubmissionByCampaignCreatorId);

router.post('/submitAgreement', isLoggedIn, agreementSubmission);
router.post('/draftSubmission', isLoggedIn, draftSubmission);
router.post('/postSubmission', isLoggedIn, postingSubmission);

router.patch('/adminManageAgreementSubmission', isSuperAdmin, adminManageAgreementSubmission);
router.patch('/adminManageDraft', isSuperAdmin, adminManageDraft);
router.patch('/adminManagePosting', isSuperAdmin, adminManagePosting);

export default router;

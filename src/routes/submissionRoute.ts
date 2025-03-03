import { Router } from 'express';
import {
  adminManageAgreementSubmission,
  adminManageDraft,
  adminManagePhotos,
  adminManagePosting,
  adminManageRawFootages,
  adminManageVideos,
  agreementSubmission,
  changePostingDate,
  draftSubmission,
  getDeliverables,
  getSubmissionByCampaignCreatorId,
  postingSubmission,
} from '@controllers/submissionController';
import { isLoggedIn } from '@middlewares/onlyLogin';
import { isSuperAdmin } from '@middlewares/onlySuperadmin';
import { generateInvoice } from '@controllers/invoiceController';

const router = Router();

router.get('/', getSubmissionByCampaignCreatorId);
router.get('/deliverables/:userId/:campaignId', isLoggedIn, getDeliverables);

router.post('/submitAgreement', isLoggedIn, agreementSubmission);
router.post('/draftSubmission', isLoggedIn, draftSubmission);
router.post('/postSubmission', isLoggedIn, postingSubmission);
router.post('/generateInvoice', isSuperAdmin, generateInvoice);

router.patch('/adminManageAgreementSubmission', isSuperAdmin, adminManageAgreementSubmission);
router.patch('/adminManageDraft', isSuperAdmin, adminManageDraft);
router.patch('/adminManagePosting', isSuperAdmin, adminManagePosting);
router.patch('/posting', isLoggedIn, isSuperAdmin, changePostingDate);
router.patch('/managePhotos', isSuperAdmin, adminManagePhotos);
router.patch('/manageVideos', isSuperAdmin, adminManageVideos);
router.patch('/manageRawFootages', isSuperAdmin, adminManageRawFootages);

export default router;

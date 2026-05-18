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
  getAllSubmissions,
  getDeliverables,
  getSubmissionByCampaignCreatorId,
  postingSubmission,
  updateSubmissionStatus,
  adminManageFinalDraft,
  adminManagePhotosV2,
  adminManageDraftVideosV2,
  adminManageRawFootagesV2,
} from '@controllers/submissionController';
import { authenticate } from '@middlewares/authenticate';
import { isSuperAdmin, isAdmin } from '@middlewares/onlySuperadmin';
import { generateInvoice } from '@controllers/invoiceController';
import {
  submitPostingLinkByCSMV2,
  approvePostingLinkBySuperadminV2,
  rejectPostingLinkBySuperadminV2,
} from '@controllers/submissionController';

const router = Router();

router.get('/', authenticate, getSubmissionByCampaignCreatorId);
router.get('/getAllsubmission', getAllSubmissions);
router.get('/deliverables/:userId/:campaignId', authenticate, getDeliverables);

router.post('/submitAgreement', authenticate, agreementSubmission);
router.post('/draftSubmission', authenticate, draftSubmission);
router.post('/postSubmission', authenticate, postingSubmission);
router.post('/adminPostSubmission', authenticate, postingSubmission);
router.post('/generateInvoice', authenticate, isSuperAdmin, generateInvoice);
// New posting link flow (V2)
// Allow admin/CSM to submit link in V2 as well (not only superadmin)
router.post('/v2/posting/submit-link', authenticate, isAdmin, submitPostingLinkByCSMV2);
router.post('/v2/posting/superadmin/approve', authenticate, isSuperAdmin, approvePostingLinkBySuperadminV2);
router.post('/v2/posting/superadmin/reject', authenticate, isSuperAdmin, rejectPostingLinkBySuperadminV2);

router.patch('/adminManageAgreementSubmission', authenticate, isSuperAdmin, adminManageAgreementSubmission);
router.patch('/adminManageDraft', authenticate, isSuperAdmin, adminManageDraft);
router.patch('/adminManagePosting', authenticate, adminManagePosting);
router.patch('/posting', authenticate, isSuperAdmin, changePostingDate);

// Section-specific management routes
router.patch('/managePhotos', authenticate, isSuperAdmin, adminManagePhotos);
router.patch('/manageVideos', authenticate, isSuperAdmin, adminManageVideos);
router.patch('/manageRawFootages', authenticate, isSuperAdmin, adminManageRawFootages);
router.patch('/manageFinalDraft', authenticate, isSuperAdmin, adminManageFinalDraft);

// Direct status update endpoint
router.patch('/status', authenticate, isSuperAdmin, updateSubmissionStatus);

// V2 - Individual media management routes
router.patch('/v2/managePhotos', authenticate, isSuperAdmin, adminManagePhotosV2);
router.patch('/v2/manageDraftVideos', authenticate, isSuperAdmin, adminManageDraftVideosV2);
router.patch('/v2/manageRawFootages', authenticate, isSuperAdmin, adminManageRawFootagesV2);

export default router;

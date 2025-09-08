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
import {
  getSubmissionsV3,
  getSubmissionByIdV3,
  approveIndividualMediaV3,
  requestChangesIndividualMediaV3,
  approveIndividualMediaByClientV3,
  requestChangesIndividualMediaByClientV3,
} from '@controllers/submissionV3Controller';
import { isLoggedIn } from '@middlewares/onlyLogin';
import { isSuperAdmin } from '@middlewares/onlySuperadmin';
import { generateInvoice } from '@controllers/invoiceController';
import { submitPostingLinkByCSMV2, approvePostingLinkBySuperadminV2, rejectPostingLinkBySuperadminV2 } from '@controllers/submissionController';

const router = Router();

router.get('/', getSubmissionByCampaignCreatorId);
router.get('/getAllsubmission', getAllSubmissions);
router.get('/deliverables/:userId/:campaignId', isLoggedIn, getDeliverables);

router.post('/submitAgreement', isLoggedIn, agreementSubmission);
router.post('/draftSubmission', isLoggedIn, draftSubmission);
router.post('/postSubmission', isLoggedIn, postingSubmission);
router.post('/generateInvoice', isSuperAdmin, generateInvoice);
// New posting link flow (V2)
router.post('/v2/posting/submit-link', isSuperAdmin, submitPostingLinkByCSMV2);
router.post('/v2/posting/superadmin/approve', isSuperAdmin, approvePostingLinkBySuperadminV2);
router.post('/v2/posting/superadmin/reject', isSuperAdmin, rejectPostingLinkBySuperadminV2);

router.patch('/adminManageAgreementSubmission', isSuperAdmin, adminManageAgreementSubmission);
router.patch('/adminManageDraft', isSuperAdmin, adminManageDraft);
router.patch('/adminManagePosting', isSuperAdmin, adminManagePosting);
router.patch('/posting', isLoggedIn, isSuperAdmin, changePostingDate);

// Section-specific management routes
router.patch('/managePhotos', isSuperAdmin, adminManagePhotos);
router.patch('/manageVideos', isSuperAdmin, adminManageVideos);
router.patch('/manageRawFootages', isSuperAdmin, adminManageRawFootages);
router.patch('/manageFinalDraft', isSuperAdmin, adminManageFinalDraft);

// Direct status update endpoint
router.patch('/status', isSuperAdmin, updateSubmissionStatus);

// V2 - Individual media management routes
router.patch('/v2/managePhotos', isSuperAdmin, adminManagePhotosV2);
router.patch('/v2/manageDraftVideos', isSuperAdmin, adminManageDraftVideosV2);
router.patch('/v2/manageRawFootages', isSuperAdmin, adminManageRawFootagesV2);

// V3 - Client-created campaign routes
router.get('/v3', isLoggedIn, getSubmissionsV3);
router.get('/v3/:submissionId', isLoggedIn, getSubmissionByIdV3);
router.patch('/v3/media/approve', isLoggedIn, approveIndividualMediaV3);
router.patch('/v3/media/request-changes', isLoggedIn, requestChangesIndividualMediaV3);
router.patch('/v3/media/approve/client', isLoggedIn, approveIndividualMediaByClientV3);
router.patch('/v3/media/request-changes/client', isLoggedIn, requestChangesIndividualMediaByClientV3);

export default router;

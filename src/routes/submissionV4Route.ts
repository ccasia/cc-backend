import express from 'express';
import {
  createV4Submissions,
  getV4SubmissionsController,
  submitV4ContentController,
  approveV4Submission,
  updatePostingLinkController,
  getV4SubmissionById,
  approveV4SubmissionByClient,
  forwardClientFeedbackV4,
  approvePostingLinkV4,
  approveIndividualContentV4,
  requestChangesIndividualContentV4,
  approveIndividualContentByClientV4,
  requestChangesIndividualContentByClientV4,
  getIndividualContentFeedbackV4,
  getPhotoFeedbackV4,
  forwardPhotoFeedbackV4,
  getRawFootageFeedbackV4,
  forwardRawFootageFeedbackV4,
  getSubmissionStatusInfo,
  updateSubmissionDueDate,
  getCaptionHistory,
} from '../controller/submissionV4Controller';
import { isLoggedIn } from '../middleware/onlyLogin';
import { isAdmin } from '../middleware/onlySuperadmin';
import { isClient } from '@middlewares/clientOnly';

const router = express.Router();

/**
 * V4 Submission Routes
 * All routes are prefixed with /api/submissions/v4
 */

// Create V4 submissions when creator is approved
router.post('/create', createV4Submissions);

// Get V4 submissions for a campaign
router.get('/submissions', getV4SubmissionsController);

// Get single V4 submission by ID
router.get('/submission/:id', getV4SubmissionById);

// Get submission status information for a role
router.get('/status/:submissionId', getSubmissionStatusInfo);

// Submit content for a V4 submission (creator uploads content)
router.post('/submit-content', submitV4ContentController);

// Approve/reject V4 submission (admin action)
router.post('/approve', isLoggedIn, isAdmin, approveV4Submission);

// Client approve/reject V4 submission (client action for client-created campaigns)
router.post('/approve/client', isLoggedIn, isClient, approveV4SubmissionByClient);

// Admin forward client feedback to creator
router.post('/forward-client-feedback', isLoggedIn, isAdmin, forwardClientFeedbackV4);

// Admin forward individual photo feedback to creator
router.post('/forward-photo-feedback', isLoggedIn, isAdmin, forwardPhotoFeedbackV4);

// Admin forward individual raw footage feedback to creator
router.post('/forward-raw-footage-feedback', isLoggedIn, isAdmin, forwardRawFootageFeedbackV4);

// Update posting link for approved submission (creator action)
router.put('/posting-link', updatePostingLinkController);

// Update due date for submission (admin action)
router.put('/due-date', isLoggedIn, isAdmin, updateSubmissionDueDate);

// Admin approve/reject posting link (admin action)
router.post('/posting-link/approve', isLoggedIn, isAdmin, approvePostingLinkV4);

// Individual content feedback endpoints (following v3 pattern)
router.patch('/content/approve', isLoggedIn, isAdmin, approveIndividualContentV4);
router.patch('/content/request-changes', isLoggedIn, isAdmin, requestChangesIndividualContentV4);
router.patch('/content/approve/client', isLoggedIn, isClient, approveIndividualContentByClientV4);
router.patch('/content/request-changes/client', isLoggedIn, isClient, requestChangesIndividualContentByClientV4);
router.get('/photo/:photoId/feedback', isLoggedIn, getPhotoFeedbackV4);
router.get('/rawFootage/:rawFootageId/feedback', isLoggedIn, getRawFootageFeedbackV4);
router.get('/content/feedback/:contentType/:contentId', isLoggedIn, getIndividualContentFeedbackV4);

// Caption history endpoint
router.get('/:submissionId/caption-history', isLoggedIn, getCaptionHistory);

export default router;

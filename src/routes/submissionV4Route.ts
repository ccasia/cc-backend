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
  getComments,
  createComment,
  toggleAgree,
  toggleResolve,
  toggleCreatorVisibility,
  updateComment,
  deleteComment,
  deleteCommentByClient,
  sendVideoFeedbackToCreator,
  sendVideoFeedbackToClient,
} from '../controller/submissionV4Controller';

import { authenticate } from '../middleware/onlyLogin';
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
router.post('/approve', authenticate, isAdmin, approveV4Submission);

// Client approve/reject V4 submission (client action for client-created campaigns)
router.post('/approve/client', authenticate, isClient, approveV4SubmissionByClient);

// Admin forward client feedback to creator
router.post('/forward-client-feedback', authenticate, isAdmin, forwardClientFeedbackV4);

// Admin forward individual photo feedback to creator
router.post('/forward-photo-feedback', authenticate, isAdmin, forwardPhotoFeedbackV4);

// Admin forward individual raw footage feedback to creator
router.post('/forward-raw-footage-feedback', authenticate, isAdmin, forwardRawFootageFeedbackV4);

// Update posting link for approved submission (creator action)
router.put('/posting-link', updatePostingLinkController);

// Update due date for submission (admin action)
router.put('/due-date', authenticate, isAdmin, updateSubmissionDueDate);

// Admin approve/reject posting link (admin action)
router.post('/posting-link/approve', authenticate, isAdmin, approvePostingLinkV4);

// Individual content feedback endpoints (following v3 pattern)
router.patch('/content/approve', authenticate, isAdmin, approveIndividualContentV4);
router.patch('/content/request-changes', authenticate, isAdmin, requestChangesIndividualContentV4);
router.patch('/content/approve/client', authenticate, isClient, approveIndividualContentByClientV4);
router.patch('/content/request-changes/client', authenticate, isClient, requestChangesIndividualContentByClientV4);
router.get('/photo/:photoId/feedback', authenticate, getPhotoFeedbackV4);
router.get('/rawFootage/:rawFootageId/feedback', authenticate, getRawFootageFeedbackV4);
router.get('/content/feedback/:contentType/:contentId', authenticate, getIndividualContentFeedbackV4);

// Caption history endpoint
router.get('/:submissionId/caption-history', authenticate, getCaptionHistory);

// Comment endpoints
router.get('/submission/:submissionId/comments', authenticate, getComments);
router.post('/submission/:submissionId/comments', authenticate, createComment);
router.patch('/comments/:commentId', authenticate, isAdmin, updateComment);
router.delete('/comments/:commentId', authenticate, isAdmin, deleteComment);
router.post('/comments/:commentId/agree', authenticate, isClient, toggleAgree);
router.delete('/comments/:commentId/client', authenticate, isClient, deleteCommentByClient);
router.patch('/comments/:commentId/resolve', authenticate, isAdmin, toggleResolve);
router.patch('/comments/:commentId/visibility', authenticate, isAdmin, toggleCreatorVisibility);

// Comment-based feedback actions
router.post('/submission/:submissionId/send-to-creator', authenticate, isAdmin, sendVideoFeedbackToCreator);
router.post('/submission/:submissionId/send-to-client', authenticate, isAdmin, sendVideoFeedbackToClient);

export default router;

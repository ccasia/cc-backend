import express from 'express';
import {
  createV4Submissions,
  getV4SubmissionsController,
  submitV4ContentController,
  approveV4Submission,
  updatePostingLinkController,
  getV4SubmissionById,
  approveV4SubmissionByClient,
  forwardClientFeedbackV4
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

// Submit content for a V4 submission (creator uploads content)
router.post('/submit-content', submitV4ContentController);

// Approve/reject V4 submission (admin action)
router.post('/approve', isLoggedIn, isAdmin, approveV4Submission);

// Client approve/reject V4 submission (client action for client-created campaigns)
router.post('/approve/client', isLoggedIn, isClient, approveV4SubmissionByClient);

// Admin forward client feedback to creator
router.post('/forward-client-feedback', isLoggedIn, isAdmin, forwardClientFeedbackV4);

// Update posting link for approved submission (creator action)
router.put('/posting-link', updatePostingLinkController);

export default router;
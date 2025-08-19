import express from 'express';
import {
  createV4Submissions,
  getV4SubmissionsController,
  submitV4ContentController,
  approveV4Submission,
  updatePostingLinkController,
  getV4SubmissionById
} from '../controller/submissionV4Controller';

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
router.post('/approve', approveV4Submission);

// Update posting link for approved submission (creator action)
router.put('/posting-link', updatePostingLinkController);

export default router;
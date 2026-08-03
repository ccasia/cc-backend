import { Router } from 'express';
import {
  getMyV2Submissions,
  getMyV2SubmissionDetails,
  updateMyV2PostingLink,
} from '../controller/creatorSubmissionV2Controller';
import { authenticate } from '../middleware/authenticate';
import { isCreator } from '../middleware/isCreator';

const router = Router();

// Apply authentication middleware to all routes
router.use(authenticate);
router.use(isCreator);

/**
 * @route GET /api/creator/submissions/v2
 * @desc Get creator's own V2 (legacy) submissions for a campaign, normalized to
 *       the V4 grouped shape so the mobile app can reuse its V4 components.
 * @access Private (Creator only)
 * @query campaignId - Required campaign ID
 */
router.get('/', getMyV2Submissions);

/**
 * @route PUT /api/creator/submissions/v2/posting-link
 * @desc Submit or resubmit the creator's legacy V2 POSTING link.
 * @access Private (Creator only)
 * @body submissionId, postingLink
 */
router.put('/posting-link', updateMyV2PostingLink);

/**
 * @route GET /api/creator/submissions/v2/:submissionId
 * @desc Get detailed view of the creator's specific V2 submission (normalized).
 * @access Private (Creator only)
 * @param submissionId - Submission ID
 */
router.get('/:submissionId', getMyV2SubmissionDetails);

export default router;

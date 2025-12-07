import { Router } from 'express';
import {
  getMyV4Submissions,
  submitMyV4Content,
  updateMyPostingLink,
  getMySubmissionDetails,
  getMyCampaignOverview,
} from '../controller/creatorSubmissionV4Controller';
import { isLoggedIn } from '../middleware/onlyLogin';
import { isCreator } from '../middleware/isCreator';

const router = Router();

// Apply authentication middleware to all routes
router.use(isLoggedIn);
router.use(isCreator);

/**
 * @route GET /api/creator/submissions/v4
 * @desc Get creator's own V4 submissions for a campaign
 * @access Private (Creator only)
 * @query campaignId - Required campaign ID
 */
router.get('/', getMyV4Submissions);

/**
 * @route GET /api/creator/submissions/v4/campaign-overview
 * @desc Get creator's campaign overview with submission summary
 * @access Private (Creator only)
 * @query campaignId - Required campaign ID
 */
router.get('/campaign-overview', getMyCampaignOverview);

/**
 * @route GET /api/creator/submissions/v4/:submissionId
 * @desc Get detailed view of creator's specific V4 submission
 * @access Private (Creator only)
 * @param submissionId - Submission ID
 */
router.get('/:submissionId', getMySubmissionDetails);

/**
 * @route POST /api/creator/submissions/v4/submit-content
 * @desc Submit content for creator's V4 submission
 * @access Private (Creator only)
 * @body submissionId, videoUrls?, photoUrls?, rawFootageUrls?, caption?
 */
router.post('/submit-content', submitMyV4Content);

/**
 * @route PUT /api/creator/submissions/v4/posting-link
 * @desc Update posting link for creator's approved V4 submission
 * @access Private (Creator only)
 * @body submissionId, postingLink
 */
router.put('/posting-link', updateMyPostingLink);

export default router;

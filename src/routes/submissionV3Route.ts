import { Router, Request, Response, NextFunction } from 'express';
import { isAdminOrClient } from '../middleware/adminOrClient';
import { isAdmin } from '../middleware/onlySuperadmin';
import { isClient } from '../middleware/clientOnly';
import { needPermissions } from '../middleware/needPermissions';
import { PrismaClient } from '@prisma/client';
import {
  getSubmissionsV3,
  getSubmissionByIdV3,
  submitDraftV3,
  approveDraftByAdminV3,
  requestChangesByAdminV3,
  approveDraftByClientV3,
  requestChangesByClientV3,
  forwardClientFeedbackV3,
  approveIndividualMediaV3,
  requestChangesIndividualMediaV3,
  approveSubmissionByClientV3,
  checkAndUpdateSubmissionStatusV3,
  requestChangesIndividualMediaByClientV3,
  approveIndividualMediaByClientV3,
  approvePostingByAdminV3,
  requestChangesForPostingByAdminV3,
  approvePostingByClientV3,
  requestChangesForPostingByClientV3,
  forwardClientPostingFeedbackV3,
} from '../controller/submissionV3Controller';

const router = Router();
const prisma = new PrismaClient();

// Custom middleware to allow both creators and clients
const isCreatorOrClient = async (req: Request, res: Response, next: NextFunction) => {
  const userId = req.session.userid;
  if (!userId) return res.status(401).json({ message: 'You are not logged in' });
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return res.status(404).json({ message: 'User not found' });
  if (user.role === 'creator' || user.role === 'client') return next();
  return res.status(403).json({ message: 'Access denied: Creator or client access required' });
};

// Get submissions for V3 flow with role-based status display
router.get('/v3', isAdminOrClient, getSubmissionsV3);

// Get single submission with role-based status display
router.get('/v3/:submissionId', isAdminOrClient, getSubmissionByIdV3);

// V3: Creator or client submits draft
router.post('/v3/submit-draft', isCreatorOrClient, submitDraftV3);

// V3 Individual Media Admin Approval/Rejection
router.patch('/v3/media/approve', isAdmin, approveIndividualMediaV3);
router.patch('/v3/media/request-changes', isAdmin, requestChangesIndividualMediaV3);

// V3 Individual Media Client Approval/Rejection
router.patch('/v3/media/approve/client', isClient, approveIndividualMediaByClientV3);
router.patch('/v3/media/request-changes/client', isClient, requestChangesIndividualMediaByClientV3);

// V3 Submission Client Approval
router.patch('/v3/:submissionId/approve/client', isClient, approveSubmissionByClientV3);

// V3 Posting Admin Approval/Rejection
router.patch('/v3/posting/approve', isAdmin, approvePostingByAdminV3);
router.patch('/v3/posting/request-changes', isAdmin, requestChangesForPostingByAdminV3);

// V3 Posting Client Approval/Rejection
router.patch('/v3/posting/approve/client', isClient, approvePostingByClientV3);
router.patch('/v3/posting/request-changes/client', isClient, requestChangesForPostingByClientV3);

// V3 Posting Client Feedback Forward
router.patch('/v3/posting/forward-feedback', isAdmin, forwardClientPostingFeedbackV3);

export default router; 
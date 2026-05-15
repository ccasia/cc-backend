import { Router } from 'express';
// import { isLoggedIn } from '@middlewares/onlyLogin';
import { isAdminOrClient } from '@middlewares/adminOrClient';
import { createApprovalRequest, getApprovalRequest, actionApprovalCreator } from '@controllers/approvalController';
import { authenticate } from '../middleware/authenticate';

const router = Router();

// Authenticated: create an approval request (admin or client)
router.post('/', authenticate, isAdminOrClient, createApprovalRequest);

// Unauthenticated: token-gated approval page and actions
router.get('/:token', getApprovalRequest);
router.patch('/:token/creators/:pitchId', actionApprovalCreator);

export default router;

import { Router } from 'express';
import { isLoggedIn } from '@middlewares/onlyLogin';
import { isAdminOrClient } from '@middlewares/adminOrClient';
import {
  createApprovalRequest,
  getApprovalRequest,
  actionApprovalCreator,
} from '@controllers/approvalController';

const router = Router();

// Authenticated: create an approval request (admin or client)
router.post('/', isLoggedIn, isAdminOrClient, createApprovalRequest);

// Unauthenticated: token-gated approval page and actions
router.get('/:token', getApprovalRequest);
router.patch('/:token/creators/:pitchId', actionApprovalCreator);

export default router;

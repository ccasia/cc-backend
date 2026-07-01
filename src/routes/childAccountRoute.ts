import express from 'express';
import { authenticate } from '@middlewares/authenticate';
import { isAdminOrClient } from '@middlewares/adminOrClient';
import {
  getChildAccounts,
  getAllChildAccounts,
  createChildAccount,
  resendInvitation,
  grantAccess,
  removeAccess,
  deleteChildAccount,
  getChildAccountByToken,
  activateChildAccount,
} from '@controllers/childAccountController';

const router = express.Router();

router.get('/all', authenticate, getAllChildAccounts);
router.get('/client/:clientId', authenticate, getChildAccounts);
router.post('/client/:clientId', authenticate, isAdminOrClient, createChildAccount);
router.post('/:childAccountId/resend', authenticate, isAdminOrClient, resendInvitation);
router.post('/:childAccountId/grant-access', authenticate, isAdminOrClient, grantAccess);
router.post('/:childAccountId/remove-access', authenticate, isAdminOrClient, removeAccess);
router.delete('/:childAccountId', authenticate, isAdminOrClient, deleteChildAccount);

router.get('/token/:token', getChildAccountByToken);
router.post('/activate/:token', activateChildAccount);

export default router;

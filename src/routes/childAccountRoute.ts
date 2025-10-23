import express from 'express';
import { isLoggedIn } from '@middlewares/onlyLogin';
import { isAdminOrClient } from '@middlewares/adminOrClient';
import {
  getChildAccounts,
  createChildAccount,
  resendInvitation,
  grantAccess,
  removeAccess,
  deleteChildAccount,
  getChildAccountByToken,
  activateChildAccount,
} from '@controllers/childAccountController';

const router = express.Router();

router.get('/client/:clientId', isLoggedIn, getChildAccounts);
router.post('/client/:clientId', isLoggedIn, isAdminOrClient, createChildAccount);
router.post('/:childAccountId/resend', isLoggedIn, isAdminOrClient, resendInvitation);
router.post('/:childAccountId/grant-access', isLoggedIn, isAdminOrClient, grantAccess);
router.post('/:childAccountId/remove-access', isLoggedIn, isAdminOrClient, removeAccess);
router.delete('/:childAccountId', isLoggedIn, isAdminOrClient, deleteChildAccount);

router.get('/token/:token', getChildAccountByToken);
router.post('/activate/:token', activateChildAccount);

export default router;

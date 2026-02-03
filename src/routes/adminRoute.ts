import { Router } from 'express';
import {
  deleteAdminById,
  disconnectXero,
  endImpersonatingSession,
  getAllAdmins,
  impersonateCreator,
} from '@controllers/adminController';
import { needPermissions } from '@middlewares/needPermissions';
import { isSuperAdmin } from '@middlewares/onlySuperadmin';
import { isLoggedIn } from '@middlewares/onlyLogin';
import { disconnectXeroIntegration } from '@controllers/invoiceController';

const router = Router();

router.get('/getAllAdmins', isLoggedIn, getAllAdmins);

router.patch('/xero/disconnect', isLoggedIn, disconnectXeroIntegration);

router.post('/impersonate-creator', isLoggedIn, impersonateCreator);

router.post('/impersonate-creator/end', isLoggedIn, endImpersonatingSession);

router.delete('/:id', needPermissions(['delete:admin']), isSuperAdmin, deleteAdminById);

export default router;

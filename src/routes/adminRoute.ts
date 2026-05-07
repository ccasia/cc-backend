import { Router } from 'express';
import {
  deleteAdminById,
  disconnectXero,
  endImpersonatingSession,
  getAllAdmins,
  impersonateClient,
  impersonateCreator,
} from '@controllers/adminController';
import { needPermissions } from '@middlewares/needPermissions';
import { isSuperAdmin } from '@middlewares/onlySuperadmin';
import { authenticate } from '@middlewares/onlyLogin';
import { disconnectXeroIntegration } from '@controllers/invoiceController';

const router = Router();

router.get('/getAllAdmins', authenticate, getAllAdmins);

router.patch('/xero/disconnect', authenticate, disconnectXeroIntegration);

router.post('/impersonate-creator', authenticate, impersonateCreator);

router.post('/impersonate-client', authenticate, impersonateClient);

router.post('/impersonate-creator/end', authenticate, endImpersonatingSession);

router.delete('/:id', needPermissions(['delete:admin']), isSuperAdmin, deleteAdminById);

export default router;

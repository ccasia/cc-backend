import { Router } from 'express';
import { deleteAdminById, disconnectXero } from '@controllers/adminController';
import { needPermissions } from '@middlewares/needPermissions';
import { isSuperAdmin } from '@middlewares/onlySuperadmin';
import { isLoggedIn } from '@middlewares/onlyLogin';
import { disconnectXeroIntegration } from '@controllers/invoiceController';

const router = Router();

router.patch('/xero/disconnect', isLoggedIn, disconnectXeroIntegration);

router.delete('/:id', needPermissions(['delete:admin']), isSuperAdmin, deleteAdminById);

// router.post('/creator', isSuperAdmin, createCreatorAccount);

export default router;

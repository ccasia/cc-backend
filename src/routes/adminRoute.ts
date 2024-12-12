import { Router } from 'express';
import { deleteAdminById, getDashboardOverview } from '@controllers/adminController';
import { needPermissions } from '@middlewares/needPermissions';
import { isSuperAdmin } from '@middlewares/onlySuperadmin';

const router = Router();

router.get('/overview', getDashboardOverview);

router.delete('/:id', needPermissions(['delete:admin']), isSuperAdmin, deleteAdminById);

// router.post('/creator', isSuperAdmin, createCreatorAccount);

export default router;

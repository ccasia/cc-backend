import { Router } from 'express';

import { isSuperAdmin } from '@middlewares/onlySuperadmin';

import { fetchAllPackages, createPackages, clientPackageHistory } from '@controllers/packageController';
import { needPermissions } from '@middlewares/needPermissions';

const router = Router();

router.get('/fetchAll', isSuperAdmin, fetchAllPackages);
router.post('/seedPackages', isSuperAdmin, createPackages);
router.get('/history/:id', isSuperAdmin, clientPackageHistory);

export default router;

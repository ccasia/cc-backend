import { Router } from 'express';

import { isSuperAdmin } from '@middlewares/onlySuperadmin';

import { fetchAllPackages, createPackages, clientPackageHistory } from '@controllers/packageController';

const router = Router();

router.get('/fetchAll', isSuperAdmin, fetchAllPackages);
router.post('/seedPackages', createPackages);
router.get('/history/:id', isSuperAdmin, clientPackageHistory);

export default router;

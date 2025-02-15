import { Router } from 'express';

import { isSuperAdmin } from '@middlewares/onlySuperadmin';
import { createPackage, getAllPackages, updatePackage } from '@controllers/packageController';

const router = Router();

router.get('/', isSuperAdmin, getAllPackages);
router.get('/:id');
router.post('/', isSuperAdmin, createPackage);
router.patch('/:id', isSuperAdmin, updatePackage);
router.delete('/:id');

// router.get('/fetchAll', isSuperAdmin, fetchAllPackages);
// router.post('/seedPackages', createPackages);
// router.get('/history/:id', isSuperAdmin, clientPackageHistory);

export default router;

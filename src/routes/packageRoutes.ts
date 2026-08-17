import { Router } from 'express';

import { isSuperAdmin, isBdOrSuperadmin } from '@middlewares/onlySuperadmin';
import { createPackage, deletePackage, getAllPackages, updatePackage } from '@controllers/packageController';
import { authenticate } from '../middleware/authenticate';

const router = Router();

router.get('/', authenticate, isBdOrSuperadmin, getAllPackages);
router.get('/:id');
router.post('/', authenticate, isSuperAdmin, createPackage);
router.patch('/:id', authenticate, isSuperAdmin, updatePackage);
router.delete('/:id', authenticate, isSuperAdmin, deletePackage);

// router.get('/fetchAll', isSuperAdmin, fetchAllPackages);
// router.post('/seedPackages', createPackages);
// router.get('/history/:id', isSuperAdmin, clientPackageHistory);

export default router;

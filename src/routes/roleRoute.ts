import { Router } from 'express';
import { getAllRoles, getSpecificRole, updateRole } from '@controllers/roleController';
import { isSuperAdmin } from '@middlewares/onlySuperadmin';
import { authenticate } from '../middleware/authenticate';

const router = Router();

router.get('/', authenticate, isSuperAdmin, getAllRoles);

router.get('/:id', authenticate, isSuperAdmin, getSpecificRole);

router.patch('/:id', authenticate, isSuperAdmin, updateRole);

export default router;

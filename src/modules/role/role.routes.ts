import { Router } from 'express';
import { isSuperAdmin } from '@middlewares/onlySuperadmin';
import { authenticate } from '@middlewares/authenticate';
import { getAllRoles, getSpecificRole, updateRole } from './role.controller';

const router = Router();

router.get('/', authenticate, isSuperAdmin, getAllRoles);

router.get('/:id', authenticate, isSuperAdmin, getSpecificRole);

router.patch('/:id', authenticate, isSuperAdmin, updateRole);

export default router;

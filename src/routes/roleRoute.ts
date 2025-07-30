import { Router } from 'express';
import { createRole, getAllRoles, getSpecificRole, updateRole } from '@controllers/roleController';
import { isSuperAdmin } from '@middlewares/onlySuperadmin';

const router = Router();

router.get('/', isSuperAdmin, getAllRoles);

router.get('/:id', isSuperAdmin, getSpecificRole);

router.post('/', isSuperAdmin, createRole);

router.patch('/:id', isSuperAdmin, updateRole);

export default router;

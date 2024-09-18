import { Router } from 'express';
import { getAllRoles, getSpecificRole } from '@controllers/roleController';
import { isSuperAdmin } from '@middlewares/onlySuperadmin';

const router = Router();

router.get('/', isSuperAdmin, getAllRoles);

router.get('/:id', isSuperAdmin, getSpecificRole);

export default router;

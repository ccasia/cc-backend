import { Router } from 'express';
import { getAllRoles } from '@controllers/roleController';
import { isSuperAdmin } from '@middlewares/onlySuperadmin';

const router = Router();

router.get('/', isSuperAdmin, getAllRoles);

export default router;

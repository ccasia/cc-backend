import { Router } from 'express';
import { getAllRoles } from './controller/roleController';
import { isSuperAdmin } from './middleware/onlySuperadmin';

const router = Router();

router.get('/', isSuperAdmin, getAllRoles);

export default router;

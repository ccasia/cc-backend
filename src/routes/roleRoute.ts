import { Router } from 'express';
import { getAllRoles } from 'src/controller/roleController';
import { isSuperAdmin } from 'src/middleware/onlySuperadmin';

const router = Router();

router.get('/', isSuperAdmin, getAllRoles);

export default router;

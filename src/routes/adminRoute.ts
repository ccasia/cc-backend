import { Router } from 'express';
import { deleteAdminById } from './controller/adminController';
import { needPermissions } from './middleware/needPermissions';
import { isSuperAdmin } from './middleware/onlySuperadmin';

const router = Router();

router.delete('/:id', needPermissions(['delete:admin']), isSuperAdmin, deleteAdminById);

export default router;

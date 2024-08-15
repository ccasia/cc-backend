import { Router } from 'express';
import { deleteAdminById } from 'src/controller/adminController';
import { needPermissions } from 'src/middleware/needPermissions';
import { isSuperAdmin } from 'src/middleware/onlySuperadmin';

const router = Router();

router.delete('/:id', needPermissions(['delete:admin']), isSuperAdmin, deleteAdminById);

export default router;

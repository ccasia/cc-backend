import { Router } from 'express';
import { deleteAdminById } from 'src/controller/adminController';
import { isSuperAdmin } from 'src/middleware/onlySuperadmin';

const router = Router();

router.delete('/:id', isSuperAdmin, deleteAdminById);

export default router;

import { Router } from 'express';
import {
  getAdmins,
  inviteAdmin,
  updateAdminInformation,
  updateProfileAdmin,
  createAdmin,
} from '@controllers/userController';
import { isSuperAdmin } from '@middlewares/onlySuperadmin';

const router = Router();

router.get('/admins', isSuperAdmin, getAdmins);
// router.get('/getAdmins', isSuperAdmin, getAllActiveAdmins);

router.post('/admins', inviteAdmin);
router.post('/createAdmin', isSuperAdmin, createAdmin);

router.patch('/admin/profile', isSuperAdmin, updateProfileAdmin);

router.put('/admins', updateAdminInformation);

export default router;

import { Router } from 'express';
import {
  getAdmins,
  inviteAdmin,
  updateAdminInformation,
  updateProfileAdmin,
  createAdmin,
  getAllActiveAdmins,
} from '@controllers/userController';
import { isSuperAdmin } from '@middlewares/onlySuperadmin';

// import { needPermissions } from '@middlewares/needPermissions';

const router = Router();

router.patch('/admin/profile', isSuperAdmin, updateProfileAdmin);
router.get('/admins', isSuperAdmin, getAdmins);
// router.get('/getAdmins', isSuperAdmin, getAllActiveAdmins);
router.post('/admins', inviteAdmin);
router.put('/updateProfile/newAdmin', updateAdminInformation);
router.post('/createAdmin', isSuperAdmin, createAdmin);

export default router;

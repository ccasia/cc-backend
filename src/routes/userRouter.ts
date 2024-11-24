import { Router } from 'express';
import {
  getAdmins,
  inviteAdmin,
  updateAdminInformation,
  updateProfileAdmin,
  createAdmin,
  forgetPassword,
  checkForgetPasswordToken,
  changePassword,
  getOverview,
} from '@controllers/userController';
import { isSuperAdmin } from '@middlewares/onlySuperadmin';
import { isLoggedIn } from '@middlewares/onlyLogin';

const router = Router();

router.get('/admins', isSuperAdmin, getAdmins);
router.get('/forget-password-token/:token', checkForgetPasswordToken);
router.get('/overview/:userId', isLoggedIn, getOverview);
// router.get('/getAdmins', isSuperAdmin, getAllActiveAdmins);

router.post('/admins', isSuperAdmin, inviteAdmin);
router.post('/createAdmin', isSuperAdmin, createAdmin);
router.post('/forget-password', forgetPassword);

router.patch('/admin/profile', isSuperAdmin, updateProfileAdmin);
router.patch('/changePassword', changePassword);

router.put('/admins', updateAdminInformation);

export default router;

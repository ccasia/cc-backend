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
  getAdminLogs,
  getUserByEmail,
} from '@controllers/userController';
import { isSuperAdmin } from '@middlewares/onlySuperadmin';
import { authenticate } from '@middlewares/authenticate';

const router = Router();

router.get('/admins', authenticate, isSuperAdmin, getAdmins);
router.get('/alladmins', authenticate, getAdmins);
router.get('/forget-password-token/:token', checkForgetPasswordToken);
router.get('/overview/:userId', authenticate, getOverview);
router.get('/by-email/:email', authenticate, isSuperAdmin, getUserByEmail);
// router.get('/getAdmins', isSuperAdmin, getAllActiveAdmins);

router.get('/admin-logs/:adminId', getAdminLogs);

router.post('/admins', authenticate, isSuperAdmin, inviteAdmin);
router.post('/createAdmin', authenticate, isSuperAdmin, createAdmin);
router.post('/forget-password', forgetPassword);

router.patch('/admin/profile', authenticate, isSuperAdmin, updateProfileAdmin);
router.patch('/changePassword', changePassword);

router.put('/admins', updateAdminInformation);

export default router;

import { Router } from 'express';
import {
  getAdmins,
  inviteAdmin,
  updateAdminInformation,
  updateProfileAdmin,
  createAdmin,
  getAllActiveAdmins,
} from 'src/controller/userController';
import { isSuperAdmin } from 'src/middleware/onlySuperadmin';
// import { PrismaClient } from '@prisma/client';
import { needPermissions } from 'src/middleware/needPermissions';

const router = Router();
// const prisma = new PrismaClient();

router.patch('/updateProfileAdmin', isSuperAdmin, updateProfileAdmin);
router.get('/admins', needPermissions(['list:admin']), isSuperAdmin, getAdmins);
router.get('/getAdmins', needPermissions(['list:admin']), isSuperAdmin, getAllActiveAdmins);
router.post('/newAdmin', needPermissions(['create:admin']), inviteAdmin);
router.put('/updateProfile/newAdmin', updateAdminInformation);
router.post('/createAdmin', needPermissions(['create:admin']), isSuperAdmin, createAdmin);

// router.post('/approveOrReject', approveOrReject);
// router.get('/:id/notification', getAllNotification);

export default router;

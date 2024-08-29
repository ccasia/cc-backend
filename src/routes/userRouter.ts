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
router.get('/admins', isSuperAdmin, getAdmins);
router.get('/getAdmins', isSuperAdmin, getAllActiveAdmins);
router.post('/newAdmin', inviteAdmin);
router.put('/updateProfile/newAdmin', updateAdminInformation);
router.post('/createAdmin', isSuperAdmin, createAdmin);

// router.post('/approveOrReject', approveOrReject);
// router.get('/:id/notification', getAllNotification);

export default router;

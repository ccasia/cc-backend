import { Router } from 'express';
import {
  registerUser,
  registerAdmin,
  login,
  displayAll,
  registerCreator,
  verifyUser,
  registerSuperAdmin,
  getprofile,
  // sendEmail,
} from '../controller/authController';
import { validateToken } from '@utils/jwtHelper';

const router = Router();
router.get('/', displayAll);
router.post('/login', login);
router.post('/me', validateToken, getprofile);
router.post('/register', registerUser);
router.post('/registerAdmin', registerAdmin);
router.put('/verfiyAdmin', verifyUser);
router.post('/registerCreator', registerCreator);
router.post('/registerSuperAdmin', registerSuperAdmin);
// router.post('/adminEmail', sendEmail);
export default router;

import { Router } from 'express';
import {
  registerUser,
  // registerAdmin,
  login,
  displayAll,
  registerCreator,
  verifyAdmin,
  registerSuperAdmin,
  getprofile,
  changePassword,
  // sendEmail,
} from '../controller/authController';
import { validateToken } from '@utils/jwtHelper';

const router = Router();
router.get('/', displayAll);
router.post('/login', login);
router.patch('/changePassword', validateToken, changePassword);
router.get('/me', validateToken, getprofile);
router.post('/register', registerUser);
// router.post('/registerAdmin', registerAdmin);
router.get('/verifyAdmin', verifyAdmin);
router.post('/registerCreator', registerCreator);
router.post('/registerSuperAdmin', registerSuperAdmin);

// router.post('/adminEmail', sendEmail);
export default router;

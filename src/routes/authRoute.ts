import { Router } from 'express';
import {
  registerUser,
  login,
  displayAll,
  registerCreator,
  verifyAdmin,
  registerSuperAdmin,
  getprofile,
  changePassword,
  logout,
} from '../controller/authController';
import { validateToken } from '@utils/jwtHelper';

const router = Router();
router.get('/', displayAll);
router.post('/login', login);
router.post('/logout', logout);
router.patch('/changePassword', validateToken, changePassword);
router.get('/me', validateToken, getprofile);
router.post('/register', registerUser);
// router.post('/registerAdmin', registerAdmin);
router.get('/verifyAdmin', verifyAdmin);
router.post('/registerCreator', registerCreator);
router.post('/registerSuperAdmin', registerSuperAdmin);

// router.post('/adminEmail', sendEmail);
export default router;

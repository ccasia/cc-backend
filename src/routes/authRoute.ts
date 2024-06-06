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
  getCurrentUser,
  checkCreator,
  // updateCreator,
  verifyCreator,
  updateCreator,
  resendVerifyTokenAdmin,
  checkTokenValidity,
} from '../controller/authController';
import { validateToken } from '@utils/jwtHelper';

const router = Router();

router.get('/', displayAll);
router.post('/login', login);
router.post('/logout', logout);
router.patch('/changePassword', validateToken, changePassword);
router.get('/me', validateToken, getprofile);
router.post('/register', registerUser);
router.get('/verifyAdmin', verifyAdmin);
router.post('/resendVerifyToken', resendVerifyTokenAdmin);
router.get('/checkTokenValidity/:token', checkTokenValidity);
router.post('/verifyCreator', verifyCreator);
router.post('/registerCreator', registerCreator);
router.post('/registerSuperAdmin', registerSuperAdmin);
router.get('/currentUser', validateToken, getCurrentUser);
router.get('/checkCreator', validateToken, checkCreator);
router.put('/updateCreator', validateToken, updateCreator);

export default router;

import { Router } from 'express';
import {
  registerUser,
  registerAdmin,
  login,
  displayAll,
  registerCreator,
  verifyUser,
  registerSuperAdmin,
  // sendEmail,
} from '../controller/authController';

const router = Router();
router.get('/', displayAll);
router.post('/login', login);
router.post('/register', registerUser);
router.post('/registerAdmin', registerAdmin);
router.put('/verfiyAdmin', verifyUser);
router.post('/registerCreator', registerCreator);
router.post('/registerSuperAdmin', registerSuperAdmin);
// router.post('/adminEmail', sendEmail);
export default router;

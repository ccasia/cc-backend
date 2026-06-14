import {
  login,
  register,
  tokenRefresh,
  updateProfile,
  updatePhoto,
  changePasword,
  verifyEmail,
  resendVerification,
} from '@controllers/mobile/authController';
import { authenticate } from '@middlewares/authenticate';
import { Router } from 'express';

const authRoute = Router();

authRoute.post('/login', login);

authRoute.post('/register', register);

authRoute.post('/refresh', tokenRefresh);

authRoute.post('/verify-email', verifyEmail);

authRoute.post('/resend-verification', resendVerification);

authRoute.patch('/updateProfile', authenticate, updateProfile);

authRoute.patch('/updatePhoto', authenticate, updatePhoto);

authRoute.patch('/changePassword', authenticate, changePasword);

export default authRoute;

import {
  login,
  register,
  tokenRefresh,
  updateProfile,
  updatePhoto,
  changePasword,
  verifyEmail,
  resendVerification,
  appleLogin,
  linkApple,
  unlinkApple,
  googleLogin,
  linkGoogle,
  unlinkGoogle,
  completeOnboarding,
} from '@controllers/mobile/authController';
import { authenticate } from '@middlewares/authenticate';
import { Router } from 'express';

const authRoute = Router();

authRoute.post('/login', login);

authRoute.post('/register', register);

authRoute.post('/refresh', tokenRefresh);

authRoute.post('/verify-email', verifyEmail);

authRoute.post('/resend-verification', resendVerification);

authRoute.post('/apple', appleLogin);

authRoute.post('/apple/link', authenticate, linkApple);

authRoute.post('/apple/unlink', authenticate, unlinkApple);

authRoute.post('/google', googleLogin);

authRoute.post('/google/link', authenticate, linkGoogle);

authRoute.post('/google/unlink', authenticate, unlinkGoogle);

authRoute.post('/complete-onboarding', authenticate, completeOnboarding);

authRoute.patch('/updateProfile', authenticate, updateProfile);

authRoute.patch('/updatePhoto', authenticate, updatePhoto);

authRoute.patch('/changePassword', authenticate, changePasword);

export default authRoute;

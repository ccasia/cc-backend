import {
  mobileLogin,
  mobileRegisterCreator,
  mobileTokenRefresh,
  mobileUpdateProfile,
  mobileUpdatePhoto,
  mobileChangePassword,
} from '@controllers/authController';
import { authenticate } from '@middlewares/authenticate';
import { Router } from 'express';

const authRoute = Router();

authRoute.post('/login', mobileLogin);

authRoute.post('/register', mobileRegisterCreator);

authRoute.post('/refresh', mobileTokenRefresh);

authRoute.patch('/updateProfile', authenticate, mobileUpdateProfile);

authRoute.patch('/updatePhoto', authenticate, mobileUpdatePhoto);

authRoute.patch('/changePassword', authenticate, mobileChangePassword);

export default authRoute;

import { mobileLogin, mobileRegisterCreator, mobileTokenRefresh } from '@controllers/authController';
import { Router } from 'express';

const authRoute = Router();

authRoute.post('/login', mobileLogin);

authRoute.post('/register', mobileRegisterCreator);

authRoute.post('/refresh', mobileTokenRefresh);

export default authRoute;

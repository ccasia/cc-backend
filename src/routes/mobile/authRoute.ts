import { mobileLogin, mobileTokenRefresh } from '@controllers/authController';
import { Router } from 'express';

const authRoute = Router();

authRoute.post('/login', mobileLogin);

authRoute.post('/refresh', mobileTokenRefresh);

export default authRoute;

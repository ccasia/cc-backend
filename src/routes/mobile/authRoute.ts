import { mobileLogin } from '@controllers/authController';
import { Router } from 'express';

const authRoute = Router();

authRoute.post('/login', mobileLogin);

export default authRoute;

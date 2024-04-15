import express from 'express';
import userRoute from './userRouter';
import authRoute from './authRoute';
export const router = express.Router();

router.use('/user', userRoute);
router.use('/auth', authRoute);

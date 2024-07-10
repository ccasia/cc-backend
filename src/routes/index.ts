import express from 'express';
import userRoute from './userRouter';
import authRoute from './authRoute';
import adminRoute from './adminRoute';
import creatorRoute from './creatorRoute';
import companyRoute from './companyRoute';
import eventRoute from './eventRoute';
import campaignRoute from './campaignRoute';
import threadRoute from './threadRoute';

export const router = express.Router();

router.use('/user', userRoute);
router.use('/auth', authRoute);
router.use('/admin', adminRoute);
router.use('/creator', creatorRoute);
router.use('/company', companyRoute);
router.use('/event', eventRoute);
router.use('/campaign', campaignRoute);
router.use('/thread', threadRoute);

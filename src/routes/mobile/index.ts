import { Router } from 'express';
import authRoute from './authRoute';
import threadRoute from './threadRoute';
import uploadSessionRoute from './uploadSession';
import { gamificationRoute } from '@/src/modules/gamification';
import { appVersionRoute } from '@/src/modules/app-version';

const router = Router();

router.use('/app-version', appVersionRoute);
router.use('/auth', authRoute);
router.use('/thread', threadRoute);
router.use('/upload-session', uploadSessionRoute);
router.use('/gamification', gamificationRoute)

export { router as mobileRouter };

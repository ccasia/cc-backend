import { Router } from 'express';
import authRoute from './authRoute';
import threadRoute from './threadRoute';
import uploadSessionRoute from './uploadSession';

const router = Router();

router.use('/auth', authRoute);
router.use('/thread', threadRoute);
router.use('/upload-session', uploadSessionRoute);

export { router as mobileRouter };

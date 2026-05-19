import { Router } from 'express';
import authRoute from './authRoute';
import threadRoute from './threadRoute';

const router = Router();

router.use('/auth', authRoute);
router.use('/thread', threadRoute);

export { router as mobileRouter };

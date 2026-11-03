import { Router } from 'express';
import authRoute from './authRoute';
import threadRoute from './threadRoute';
import uploadSessionRoute from './uploadSession';
import { gamificationRoute } from '@/src/modules/gamification';
import { archetypeQuizRoute } from '@/src/modules/archetype-quiz';

const router = Router();

router.use('/auth', authRoute);
router.use('/thread', threadRoute);
router.use('/upload-session', uploadSessionRoute);
router.use('/gamification', gamificationRoute);
router.use('/archetype-quiz', archetypeQuizRoute);

export { router as mobileRouter };

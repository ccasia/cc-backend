import { Router } from 'express';
import { authenticate } from '@middlewares/authenticate';
import {
  getCurrentLeaderboard,
  getMyCodex,
  getMyGamification,
  getMyXpHistory,
} from './gamification.controller';

const router = Router();

router.use(authenticate);

router.get('/me', getMyGamification);
router.get('/history', getMyXpHistory);
router.get('/leaderboard', getCurrentLeaderboard);
router.get('/codex', getMyCodex);

export default router;

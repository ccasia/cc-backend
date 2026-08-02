import { Router } from 'express';
import rateLimit from 'express-rate-limit';

import { authenticate } from '../middleware/authenticate';
import { createTreasureHuntController } from '../controller/treasureHuntController';
import { treasureHuntService } from '../service/treasureHuntComposition';

const router = Router();
const controller = createTreasureHuntController({ service: treasureHuntService });

// Public web-fallback token preview — rate-limited by IP; no auth.
const previewLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, code: 'RATE_LIMITED', message: 'Too many requests, try again in a moment.' },
});

// Redemption — rate-limited per IP as a coarse abuse guard on top of the
// once-per-user DB constraint.
const redeemLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, code: 'RATE_LIMITED', message: 'Too many requests, try again in a moment.' },
});

router.post('/preview', previewLimiter, controller.preview);

router.get('/featured', authenticate, controller.getFeatured);
router.get('/', authenticate, controller.list);
router.get('/claims/:claimId/capture', authenticate, controller.getCapture);
router.get('/claims/:claimId/capture-url', authenticate, controller.getCaptureUrl);
router.get('/:huntId', authenticate, controller.getDetail);
router.post('/redeem', authenticate, redeemLimiter, controller.redeem);

export default router;

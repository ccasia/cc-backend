import { Router } from 'express';
import rateLimit from 'express-rate-limit';

import { isLoggedIn } from '@middlewares/onlyLogin';
import { isBdOrSuperadmin } from '../middleware/onlySuperadmin';
import {
  getMyInviteLink,
  rotateMyInviteLink,
  getPublicInviteInfo,
  bdSubmitDraft,
} from '@controllers/bdInviteController';

const router = Router();

const publicLookupLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests, try again in a moment.' },
});

const publicSubmitLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many submissions, please slow down.' },
});

router.get('/my-invite-link', isLoggedIn, isBdOrSuperadmin, getMyInviteLink);
router.post('/my-invite-link/rotate', isLoggedIn, isBdOrSuperadmin, rotateMyInviteLink);

router.get('/invite/public/:token', publicLookupLimiter, getPublicInviteInfo);
router.post('/invite/public/:token/submit', publicSubmitLimiter, bdSubmitDraft);

export default router;

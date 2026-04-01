import { getInsight, getWhatsappSetting, updateWhatsappSetting } from '@controllers/systemSettingController';
import { isLoggedIn } from '@middlewares/onlyLogin';
import { rateLimit } from 'express-rate-limit';
import { Router } from 'express';

const router = Router();

const limiter = rateLimit({
  windowMs: 60 * 1000, // 15 minutes
  message: 'Too Many Request. Please try again in a minute.',
  limit: 5, // Limit each IP to 100 requests per `window` (here, per 15 minutes).
  standardHeaders: 'draft-8', // draft-6: `RateLimit-*` headers; draft-7 & draft-8: combined `RateLimit` header
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers.
  ipv6Subnet: 56, // Set to 60 or 64 to be less aggressive, or 52 or 48 to be more aggressive
});

router.get('/whatsapp', isLoggedIn, getWhatsappSetting);
router.get('/whatsapp-insight', isLoggedIn, getInsight);

router.post('/whatsapp', isLoggedIn, limiter, updateWhatsappSetting);

export default router;

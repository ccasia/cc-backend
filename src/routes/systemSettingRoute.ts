import {
  getInsight,
  getWhatsappMessage,
  getWhatsappSetting,
  toggleWhatsappSetting,
  updateWhatsappSetting,
} from '@controllers/systemSettingController';
// import { isLoggedIn } from '@middlewares/onlyLogin';
import { rateLimit } from 'express-rate-limit';
import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';

const router = Router();

const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 5,
  message: 'Too many requests. Please try again in a minute.',
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  ipv6Subnet: 56,
});

router.use(authenticate);

router.get('/whatsapp', getWhatsappSetting);

router.get('/whatsapp-insight', limiter, getInsight);

router.get('/whatsapp-message', getWhatsappMessage);

router.post('/whatsapp', limiter, updateWhatsappSetting);

router.patch('/whatsapp/toggle', limiter, toggleWhatsappSetting);

export default router;

import { getWhatsappSetting } from '@controllers/systemSettingController';
import { isLoggedIn } from '@middlewares/onlyLogin';
import { Router } from 'express';

const router = Router();

router.get('/whatsapp', isLoggedIn, getWhatsappSetting);

export default router;

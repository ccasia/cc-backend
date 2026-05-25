import { Router } from 'express';

import { registerPushToken, removePushToken } from '@controllers/pushTokenController';
import { authenticate } from '../middleware/authenticate';

const router = Router();

router.use(authenticate);
router.post('/', registerPushToken);
router.delete('/', removePushToken);

export default router;

import { Router } from 'express';

import { authenticate } from '@middlewares/authenticate';
import { registerPushToken, removePushToken } from './push-token.controller';

const router = Router();

router.use(authenticate);
router.post('/', registerPushToken);
router.delete('/', removePushToken);

export default router;

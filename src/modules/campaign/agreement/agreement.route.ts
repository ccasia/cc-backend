import { Router } from 'express';
import { authenticate } from '@middlewares/authenticate';
import { isSuperAdmin } from '@middlewares/onlySuperadmin';
import { bulkSendAgreementsHandler } from './agreement.controller';

const router = Router();

router.post('/bulk-send', authenticate, isSuperAdmin, bulkSendAgreementsHandler);

export default router;

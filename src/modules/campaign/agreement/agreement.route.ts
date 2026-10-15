import { Router } from 'express';
import { authenticate } from '@middlewares/authenticate';
import { isSuperAdmin } from '@middlewares/onlySuperadmin';
import { bulkSendAgreementsHandler, updateAgreementBudgetHandler } from './agreement.controller';

const router = Router();

router.post('/bulk-send', authenticate, isSuperAdmin, bulkSendAgreementsHandler);
router.patch('/:agreementId/budget', authenticate, isSuperAdmin, updateAgreementBudgetHandler);

export default router;

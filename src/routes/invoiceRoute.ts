import { Router } from 'express';

const router = Router();

import {
  createInvoice,
  getInvoicesByCreatorId,
  getInvoicesByCampaignId,
  getInvoiceById,
} from '.@controllers/invoiceController';

router.get('/creator/:id', getInvoicesByCreatorId);
router.get('/getInvoicesByCampaignId/:id', getInvoicesByCampaignId);
router.get('/:id', getInvoiceById);
router.post('/create', createInvoice);

export default router;

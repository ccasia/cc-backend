import { Router } from 'express';

const router = Router();

import {
  createInvoice,
  getInvoicesByCreatorId,
  getInvoicesByCampaignId,
  getInvoiceById,
  getInvoiceByCreatorIdAndCampaignId,
  updateInvoiceStatus,
  updateInvoice,
  getAllInvoices,
  creatorInvoice,
} from '@controllers/invoiceController';
import { isSuperAdmin } from '@middlewares/onlySuperadmin';
import { isLoggedIn } from '@middlewares/onlyLogin';

router.get('/', isSuperAdmin, getAllInvoices);
router.get('/creator', getInvoicesByCreatorId);
router.get('/getInvoicesByCampaignId/:id', getInvoicesByCampaignId);
router.get('/:id', getInvoiceById);
router.get('/creator/:creatorId/campaign/:campaignId', getInvoiceByCreatorIdAndCampaignId);
router.get('/creatorInvoice/:invoiceId', isLoggedIn, creatorInvoice);

router.post('/create', createInvoice);

router.patch('/updateStatus', updateInvoiceStatus);
router.patch('/update', updateInvoice);

export default router;

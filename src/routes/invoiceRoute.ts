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
  getXero,
} from '@controllers/invoiceController';
import { isSuperAdmin } from '@middlewares/onlySuperadmin';
import { checkAndRefreshAccessToken } from '@controllers/invoiceController';

router.get('/zeroConnect', async (req, res) => {
  console.log(req);
});
router.get('/', isSuperAdmin, getAllInvoices);
router.get('/creator', getInvoicesByCreatorId);
router.get('/getInvoicesByCampaignId/:id', getInvoicesByCampaignId);
router.get('/:id', getInvoiceById);
router.post('/create', createInvoice);
router.get('/creator/:creatorId/campaign/:campaignId', getInvoiceByCreatorIdAndCampaignId);
router.patch('/updateStatus', updateInvoiceStatus);
router.patch('/update', updateInvoice);


export default router;

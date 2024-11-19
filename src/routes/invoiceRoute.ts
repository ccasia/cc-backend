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
  xeroCallBack,
  getXeroContacts,
  checkRefreshToken,
} from '@controllers/invoiceController';
import { checkAndRefreshAccessToken } from '@controllers/invoiceController';
import { creatorInvoice } from '@controllers/invoiceController';
import { isSuperAdmin } from '@middlewares/onlySuperadmin';
import { isLoggedIn } from '@middlewares/onlyLogin';

router.get('/zeroConnect', isSuperAdmin, getXero);
router.get('/xeroCallback', xeroCallBack);
router.get('/getXeroContacts', checkAndRefreshAccessToken, getXeroContacts);
router.get('/checkRefreshToken', isSuperAdmin, checkRefreshToken);
router.get('/creator', getInvoicesByCreatorId);
router.get('/:id', getInvoiceById);
router.get('/', isSuperAdmin, getAllInvoices);
router.get('/getInvoicesByCampaignId/:id', getInvoicesByCampaignId);

router.get('/creator/:creatorId/campaign/:campaignId', getInvoiceByCreatorIdAndCampaignId);
router.get('/creatorInvoice/:invoiceId', isLoggedIn, creatorInvoice);

router.post('/create', createInvoice);

router.patch('/updateStatus', updateInvoiceStatus);
router.patch('/update', checkAndRefreshAccessToken, updateInvoice);

export default router;

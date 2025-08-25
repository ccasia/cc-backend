import { Router } from 'express';
import { deleteAdminById, disconnectXero, getAllAdmins, exportCampaignCreators, exportAllCampaignCreators } from '@controllers/adminController';
import { needPermissions } from '@middlewares/needPermissions';
import { isSuperAdmin } from '@middlewares/onlySuperadmin';
import { isLoggedIn } from '@middlewares/onlyLogin';
import { disconnectXeroIntegration } from '@controllers/invoiceController';

const router = Router();

router.get('/getAllAdmins', isLoggedIn, getAllAdmins);

router.patch('/xero/disconnect', isLoggedIn, disconnectXeroIntegration);

router.delete('/:id', needPermissions(['delete:admin']), isSuperAdmin, deleteAdminById);

router.post('/export-campaign-creators/:campaignId', isLoggedIn, exportCampaignCreators);
router.post('/export-all-campaign-creators', isLoggedIn, exportAllCampaignCreators);

// router.post('/creator', isSuperAdmin, createCreatorAccount);

export default router;

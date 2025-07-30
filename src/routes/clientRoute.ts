import { Router } from 'express';
import {
  updateClient,
  checkClientCompany,
  createClientCompany,
  createClientCampaign,
  createClientRecord,
  createClientWithCompany,
  inviteClient,
} from '@controllers/clientController';
import { isClient } from '@middlewares/clientOnly';
import { isSuperAdmin } from '@middlewares/onlySuperadmin';

const router = Router();

router.patch('/updateClient', isClient, updateClient);
router.get('/checkCompany', isClient, checkClientCompany);
router.post('/createCompany', isClient, createClientCompany);
router.post('/createClientCampaign', isClient, createClientCampaign);
router.post('/createClientRecord', createClientRecord);
router.post('/createClientWithCompany', createClientWithCompany);

router.post('/invite', isSuperAdmin, inviteClient);

export default router;

import { Router } from 'express';
import {
  updateClient,
  checkClientCompany,
  createClientCompany,
  createClientCampaign,
  createClientRecord,
  createClientWithCompany,
} from '@controllers/clientController';
import { isClient } from '@middlewares/clientOnly';
import { authenticate } from '../middleware/authenticate';

const router = Router();

router.patch('/updateClient', authenticate, isClient, updateClient);
router.get('/checkCompany', authenticate, isClient, checkClientCompany);
router.post('/createCompany', authenticate, isClient, createClientCompany);
router.post('/createClientCampaign', authenticate, isClient, createClientCampaign);
router.post('/createClientRecord', authenticate, createClientRecord);
router.post('/createClientWithCompany', authenticate, createClientWithCompany);

export default router;

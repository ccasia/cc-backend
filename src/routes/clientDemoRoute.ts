import { Router } from 'express';

import { authenticate } from '@middlewares/authenticate';
import { isClientDemo } from '@middlewares/demoOnly';
import { isBdOrSuperadmin } from '@middlewares/onlySuperadmin';
import {
  createClientDemo,
  createDemoCampaign,
  listDemoCampaigns,
  getDemoCampaignById,
  createClientDemoSession,
  getClientDemoLinkByCompany,
  regenerateClientDemoLink,
} from '@controllers/clientDemoController';

const router = Router();

router.post('/', authenticate, isBdOrSuperadmin, createClientDemo);
router.get('/company/:companyId/link', authenticate, isBdOrSuperadmin, getClientDemoLinkByCompany);
router.post(
  '/company/:companyId/regenerate',
  authenticate,
  isBdOrSuperadmin,
  regenerateClientDemoLink
);
router.post('/session/:token', createClientDemoSession);

// Demo campaign creation/listing — only reachable by a client_demo session.
router.post('/campaigns', authenticate, isClientDemo, createDemoCampaign);
router.get('/campaigns', authenticate, isClientDemo, listDemoCampaigns);
router.get('/campaigns/:id', authenticate, isClientDemo, getDemoCampaignById);

export default router;

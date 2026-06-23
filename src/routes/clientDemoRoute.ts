import { Router } from 'express';

import { authenticate } from '@middlewares/authenticate';
import { isBdOrSuperadmin } from '@middlewares/onlySuperadmin';
import {
  createClientDemo,
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

export default router;

import { Router } from 'express';
import {
  getDiscoveryCreatorsList,
  getNonPlatformDiscoveryCreatorsList,
  inviteDiscoveryCreatorsController,
} from '@controllers/discoveryController';
import { authenticate } from '@middlewares/authenticate';

const router = Router();

router.get('/creators', authenticate, getDiscoveryCreatorsList);
router.get('/non-platform-creators', authenticate, getNonPlatformDiscoveryCreatorsList);
router.post('/invite-creators', authenticate, inviteDiscoveryCreatorsController);

export default router;

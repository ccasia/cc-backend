import { Router } from 'express';
import {
  getDiscoveryCreatorsList,
  getNonPlatformDiscoveryCreatorsList,
  inviteDiscoveryCreatorsController,
} from '@controllers/discoveryController';
import { authenticate } from '@middlewares/authenticate';

const router = Router();

router.use(authenticate);
router.get('/creators', getDiscoveryCreatorsList);
router.get('/non-platform-creators', getNonPlatformDiscoveryCreatorsList);
router.post('/invite-creators', inviteDiscoveryCreatorsController);

export default router;

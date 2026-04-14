import { Router } from 'express';
import {
	getDiscoveryCreatorsList,
	getNonPlatformDiscoveryCreatorsList,
	inviteDiscoveryCreatorsController,
} from '@controllers/discoveryController';
import { isLoggedIn } from '@middlewares/onlyLogin';

const router = Router();

router.get('/creators', isLoggedIn, getDiscoveryCreatorsList);
router.get('/non-platform-creators', isLoggedIn, getNonPlatformDiscoveryCreatorsList);
router.post('/invite-creators', isLoggedIn, inviteDiscoveryCreatorsController);

export default router;

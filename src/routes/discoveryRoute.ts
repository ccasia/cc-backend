import { Router } from 'express';
import { getDiscoveryCreatorsList, inviteDiscoveryCreatorsController } from '@controllers/discoveryController';
import { isLoggedIn } from '@middlewares/onlyLogin';

const router = Router();

router.get('/creators', isLoggedIn, getDiscoveryCreatorsList);
router.post('/invite-creators', isLoggedIn, inviteDiscoveryCreatorsController);

export default router;

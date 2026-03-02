import { Router } from 'express';
import { getDiscoveryCreatorsList } from '@controllers/discoveryController';
import { isLoggedIn } from '@middlewares/onlyLogin';

const router = Router();

router.get('/creators', isLoggedIn, getDiscoveryCreatorsList);

export default router;

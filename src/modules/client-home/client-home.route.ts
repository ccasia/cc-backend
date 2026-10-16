import { Router } from 'express';
import { authenticate } from '@middlewares/authenticate';
import { isClient } from '@middlewares/clientOnly';
import { getClientHomeHandler } from './client-home.controller';

// Mounted at /client/home
const router = Router();

router.get('/', authenticate, isClient, getClientHomeHandler);

export default router;

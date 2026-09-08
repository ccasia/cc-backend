import { authenticate } from '@middlewares/authenticate';
import { Router } from 'express';
import { createNewBug } from './bug.controller';

const router = Router();

router.post('/', authenticate, createNewBug);

export default router;

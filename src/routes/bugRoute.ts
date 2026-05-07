import { createNewBug } from '@controllers/bugController';
import { authenticate } from '@middlewares/onlyLogin';
import { Router } from 'express';

const router = Router();

router.post('/', authenticate, createNewBug);

export default router;

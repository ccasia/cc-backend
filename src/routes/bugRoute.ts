import { createNewBug } from '@controllers/bugController';
import { isLoggedIn } from '@middlewares/onlyLogin';
import { Router } from 'express';

const router = Router();

router.post('/', isLoggedIn, createNewBug);

export default router;

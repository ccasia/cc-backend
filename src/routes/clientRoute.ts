import { Router } from 'express';
import { updateClient } from '@controllers/clientController';
import { isClient } from '@middlewares/clientOnly';

const router = Router();

router.patch('/updateClient', isClient, updateClient);

export default router;
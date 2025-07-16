import { Router } from 'express';
import { updateClient, checkClientCompany, createClientCompany } from '@controllers/clientController';
import { isClient } from '@middlewares/clientOnly';

const router = Router();

router.patch('/updateClient', isClient, updateClient);
router.get('/checkCompany', isClient, checkClientCompany);
router.post('/createCompany', isClient, createClientCompany);

export default router;
import { Router } from 'express';
import { authenticate } from '@middlewares/authenticate';
import { isAdmin } from '@middlewares/onlySuperadmin';
import { isCreator } from '@middlewares/isCreator';
import {
  addReceiptHandler,
  deleteReceiptHandler,
  getReimbursementsHandler,
  reviewReceiptHandler,
  setReceiptRequiredHandler,
  submitReceiptsHandler,
  updateReceiptHandler,
} from './reimbursement.controller';

const router = Router();

router.use(authenticate);

// Shared: creators get their own rounds, admins pass ?userId=
router.get('/', getReimbursementsHandler);

// Admin
router.patch('/agreement/:agreementId/required', isAdmin, setReceiptRequiredHandler);
router.patch('/:id/review', isAdmin, reviewReceiptHandler);

// Creator (multipart: `receipt` file + `data` JSON)
router.post('/', isCreator, addReceiptHandler);
router.post('/agreement/:agreementId/submit', isCreator, submitReceiptsHandler);
router.put('/:id', isCreator, updateReceiptHandler);
router.delete('/:id', isCreator, deleteReceiptHandler);

export default router;

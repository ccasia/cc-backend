import { Router } from 'express';

import { isSuperAdmin } from '@middlewares/onlySuperadmin';
import {
  getAllCreditTiers,
  createCreditTier,
  updateCreditTier,
  deleteCreditTier,
} from '@controllers/creditTierController';
import { authenticate } from '../middleware/authenticate';

const router = Router();

router.use(authenticate);

router.get('/', isSuperAdmin, getAllCreditTiers);
router.post('/', isSuperAdmin, createCreditTier);
router.put('/:id', isSuperAdmin, updateCreditTier);
router.delete('/:id', isSuperAdmin, deleteCreditTier);

export default router;

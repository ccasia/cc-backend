import { Router } from 'express';
import { isAdmin, isSuperAdmin } from '@middlewares/onlySuperadmin';
import {
  getUserByEmail,
  updatePIC,
  getPICById,
  getPICsByCompanyId,
  createPIC,
} from '@controllers/picController';

const router = Router();

// Get user by email (for status checking)
router.get('/user/by-email/:email', isSuperAdmin, getUserByEmail);

// Get PIC by ID
router.get('/:id', isSuperAdmin, getPICById);

// Get all PICs for a company
router.get('/company/:companyId', isSuperAdmin, getPICsByCompanyId);

// Create a PIC for a company — companyId comes from the URL param
router.post('/company/:companyId', isAdmin, createPIC);

// Update PIC
router.patch('/:id', isSuperAdmin, updatePIC);

export default router;

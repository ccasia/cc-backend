import { Router } from 'express';
import { isSuperAdmin } from '@middlewares/onlySuperadmin';
import { getUserByEmail, createPIC, updatePIC, getPICById, getPICsByCompanyId } from '@controllers/picController';

const router = Router();

// Get user by email (for status checking)
router.get('/user/by-email/:email', isSuperAdmin, getUserByEmail);

// Get PIC by ID
router.get('/:id', isSuperAdmin, getPICById);

// Get all PICs for a company
router.get('/company/:companyId', isSuperAdmin, getPICsByCompanyId);

// Create PIC
router.post('/', isSuperAdmin, createPIC);

// Update PIC
router.patch('/:id', isSuperAdmin, updatePIC);

export default router;

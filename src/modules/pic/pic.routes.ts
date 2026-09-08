import { Router } from 'express';
import { isAdmin, isSuperAdmin } from '@middlewares/onlySuperadmin';
import { authenticate } from '@middlewares/authenticate';
import { getUserByEmail, updatePIC, getPICById, getPICsByCompanyId, createPIC } from './pic.controller';

const router = Router();

// Get user by email (for status checking)
router.get('/user/by-email/:email', authenticate, isSuperAdmin, getUserByEmail);

// Get PIC by ID
router.get('/:id', authenticate, isSuperAdmin, getPICById);

// Get all PICs for a company
router.get('/company/:companyId', authenticate, isSuperAdmin, getPICsByCompanyId);

// Create a PIC for a company — companyId comes from the URL param
router.post('/company/:companyId', authenticate, isAdmin, createPIC);

// Update PIC
router.patch('/:id', authenticate, isSuperAdmin, updatePIC);

export default router;

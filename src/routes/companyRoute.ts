import { Router } from 'express';

import { isSuperAdmin } from 'src/middleware/onlySuperadmin';

import {
  createCompany,
  getAllCompanies,
  createBrand,
  getCompanyById,
  deleteCompany,
} from 'src/controller/companyController';

const router = Router();

router.get('/getCompanies', isSuperAdmin, getAllCompanies);
router.get('/getCompany/:id', isSuperAdmin, getCompanyById);
router.post('/createCompany', isSuperAdmin, createCompany);
router.post('/createBrand', isSuperAdmin, createBrand);
router.delete('/deleteCompany/:id', isSuperAdmin, deleteCompany);

export default router;

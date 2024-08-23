import { Router } from 'express';

import { isSuperAdmin } from 'src/middleware/onlySuperadmin';

import {
  createCompany,
  getAllCompanies,
  createBrand,
  getAllBrands,
  createOneCompany,
  createOneBrand,
  deleteCompany,
  getCompanyById,
  editCompany,
  getBrand,
  editBrand,
  getOptions,
} from 'src/controller/companyController';
import { needPermissions } from 'src/middleware/needPermissions';

const router = Router();

router.get('/getCompany/:id', needPermissions(['view:client']), isSuperAdmin, getCompanyById);
router.get('/getCompanies', needPermissions(['list:client']), isSuperAdmin, getAllCompanies);
router.get('/getBrands', needPermissions(['list:client']), isSuperAdmin, getAllBrands);
router.get('/getOptions', isSuperAdmin, getOptions);
router.get('/getBrand/:id', needPermissions(['view:client']), isSuperAdmin, getBrand);

router.post('/createCompany', needPermissions(['create:client']), isSuperAdmin, createCompany);
router.post('/createBrand', needPermissions(['create:client']), isSuperAdmin, createBrand);
router.post('/createOneCompany', needPermissions(['create:client']), isSuperAdmin, createOneCompany);
router.post('/createOneBrand', needPermissions(['create:client']), isSuperAdmin, createOneBrand);
router.post('/createCompany', needPermissions(['create:client']), isSuperAdmin, createCompany);
router.post('/createBrand', needPermissions(['create:client']), isSuperAdmin, createBrand);

router.patch('/editCompany', needPermissions(['update:client']), isSuperAdmin, editCompany);
router.patch('/editBrand', needPermissions(['update:client']), isSuperAdmin, editBrand);

router.delete('/deleteCompany/:id', needPermissions(['delete:client']), isSuperAdmin, deleteCompany);

export default router;

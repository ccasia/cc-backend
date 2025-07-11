import { Router } from 'express';

import { isSuperAdmin } from '@middlewares/onlySuperadmin';
import { isAdminOrClient } from '@middlewares/adminOrClient';

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
  getBrandsByClientId,
  handleLinkNewPackage,
  getUniqueClientId,
  clientOverview,
  activateClient,
} from '@controllers/companyController';
const router = Router();

router.get('/', isSuperAdmin, clientOverview);
router.get('/getCompany/:id', isSuperAdmin, getCompanyById);
router.get('/getCompanies', isAdminOrClient, getAllCompanies);
router.get('/getBrands', isSuperAdmin, getAllBrands);
router.get('/getOptions', isSuperAdmin, getOptions);
router.get('/getBrand/:id', isSuperAdmin, getBrand);
router.get('/getBrands/:id', isSuperAdmin, getBrandsByClientId);
router.get('/getUniqueCompanyId', isSuperAdmin, getUniqueClientId);

router.post('/createCompany', isSuperAdmin, createCompany);
router.post('/createBrand', isSuperAdmin, createBrand);
router.post('/createOneCompany', isSuperAdmin, createOneCompany);
router.post('/createOneBrand', isSuperAdmin, createOneBrand);
router.post('/createBrand', isSuperAdmin, createBrand);

router.patch('/editCompany', isAdminOrClient, editCompany);
router.patch('/editBrand', isSuperAdmin, editBrand);
router.patch('/linkPackage/:companyId', isSuperAdmin, handleLinkNewPackage);

router.post('/activateClient/:companyId', isSuperAdmin, activateClient);

router.delete('/deleteCompany/:id', isSuperAdmin, deleteCompany);

export default router;

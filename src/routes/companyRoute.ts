import { Router } from 'express';

import { isSuperAdmin } from 'src/middleware/onlySuperadmin';

<<<<<<< Updated upstream
import { createCompany , getAllCompanies ,createBrand ,getAllBrands ,createOneCompany ,createOneBrand ,deleteCompany ,getCompanyById  } from "src/controller/companyController";
=======
import {
  createCompany,
  getAllCompanies,
  createBrand,
  getCompanyById,
  deleteCompany,
  editCompany,
} from 'src/controller/companyController';
>>>>>>> Stashed changes

const router = Router();

router.post("/createCompany", isSuperAdmin, createCompany);
router.get('/getCompany/:id', isSuperAdmin, getCompanyById);
<<<<<<< Updated upstream
router.get("/getCompanies", isSuperAdmin, getAllCompanies);
router.post("/createBrand", isSuperAdmin, createBrand);
router.get("/getBrands", isSuperAdmin, getAllBrands);
router.post("/createOneCompany", isSuperAdmin, createOneCompany);
router.post("/createOneBrand", isSuperAdmin, createOneBrand);
=======
router.post('/createCompany', isSuperAdmin, createCompany);
router.post('/createBrand', isSuperAdmin, createBrand);
router.patch('/editCompany', isSuperAdmin, editCompany);
>>>>>>> Stashed changes
router.delete('/deleteCompany/:id', isSuperAdmin, deleteCompany);


export default router;

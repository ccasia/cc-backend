import { Router } from 'express';

import { isSuperAdmin } from 'src/middleware/onlySuperadmin';

import { createCompany , getAllCompanies ,createBrand ,getAllBrands ,createOneCompany ,createOneBrand } from "src/controller/companyController";

const router = Router();

router.post("/createCompany", isSuperAdmin, createCompany);
router.get("/getCompanies", isSuperAdmin, getAllCompanies);
router.post("/createBrand", isSuperAdmin, createBrand);
router.get("/getBrands", isSuperAdmin, getAllBrands);
router.post("/createOneCompany", isSuperAdmin, createOneCompany);
router.post("/createOneBrand", isSuperAdmin, createOneBrand)


export default router;

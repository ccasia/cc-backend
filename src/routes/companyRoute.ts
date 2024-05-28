import { Router } from "express";

import { isSuperAdmin } from "src/middleware/onlySuperadmin";

import { createCompany , getAllCompanies ,createBrand } from "src/controller/companyController";

const router = Router();

router.post("/createCompany", isSuperAdmin, createCompany);
router.get("/getCompanies", isSuperAdmin, getAllCompanies);
router.post("/createBrand", isSuperAdmin, createBrand);


export default router;
import { Request, Response } from 'express';

import { handleCreateCompany ,handleCreateBrand } from 'src/service/companyService';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// for creating new company with brand
export const createCompany = async (req: Request, res: Response) => {
  console.log(req.body);
  try {
    const company = await handleCreateCompany(req.body);
    return res.status(201).json({ company });
  } catch (err) {
    return res.status(400).json({ message: err });
  }
};

export const getAllCompanies = async (req: Request, res: Response) => {
  console.log(req.body);
  try {
    const companies = await prisma.company.findMany();
    return res.status(200).json(companies);
  } catch (err) {
    return res.status(400).json({ message: err });
  }
};

export const createBrand = async (req: Request, res: Response) => {
  console.log(req.body);
  try {
    const brand = await handleCreateBrand(req.body);
    return res.status(201).json( brand );
  } catch (err) {
    return res.status(400).json({ message: err });
  }
}


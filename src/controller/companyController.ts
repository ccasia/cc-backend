import { Request, Response } from 'express';

import { handleCreateCompany, handleCreateBrand } from 'src/service/companyService';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// for creating new company with brand
export const createCompany = async (req: Request, res: Response) => {
  try {
    const company = await handleCreateCompany(req.body);

    return res.status(201).json({ company, message: 'A new company has been created' });
  } catch (err: any) {
    if (err.message.includes('exists')) {
      return res.status(404).json({ message: 'Company already exist' });
    }
    return res.status(400).json({ message: err });
  }
};

export const getAllCompanies = async (_req: Request, res: Response) => {
  try {
    const companies = await prisma.company.findMany({
      include: {
        brand: true,
      },
    });
    return res.status(200).json(companies);
  } catch (err) {
    console.log('DAWDAW', err);
    return res.status(400).json({ message: err });
  }
};

export const getCompanyById = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const companies = await prisma.company.findUnique({
      where: {
        id: id,
      },
      include: {
        brand: true,
      },
    });
    return res.status(200).json(companies);
  } catch (err) {
    console.log('DAWDAW', err);
    return res.status(400).json({ message: err });
  }
};

export const createBrand = async (req: Request, res: Response) => {
  try {
    const brand = await handleCreateBrand(req.body);
    return res.status(201).json(brand);
  } catch (err: any) {
    if (err.message.includes('exists')) {
      return res.status(404).json({ message: 'Company already exist' });
    }
    return res.status(400).json({ message: err });
  }
};

export const deleteCompany = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const company = await prisma.company.findUnique({
      where: {
        id: id,
      },
      include: {
        brand: true,
      },
    });

    if (company && company.brand.length < 1) {
      await prisma.company.delete({
        where: {
          id: id,
        },
      });
      return res.status(200).json({ message: 'Sucessfully remove company' });
    }

    if (company) {
      for (const item of company.brand) {
        await prisma.brand.delete({
          where: {
            id: item.id,
          },
        });
      }
      await prisma.company.delete({
        where: {
          id: id,
        },
      });
      return res.status(200).json({ message: 'Sucessfully remove company' });
    }
  } catch (error) {
    return res.status(400).json(error);
  }
};

import { Request, Response } from 'express';

import { handleCreateCompany, handleCreateBrand } from 'src/service/companyService';
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
    return res.status(201).json(brand);
  } catch (err) {
    return res.status(400).json({ message: err });
  }
};
export const getAllBrands = async (req: Request, res: Response) => {
  console.log(req.body);
  try {
    const brands = await prisma.brand.findMany();
    return res.status(200).json(brands);
  } catch (err) {
    return res.status(400).json({ message: err });
  }
};

export const createOneCompany = async (req: Request, res: Response) => {
  console.log(req.body);
  try {
    const company = await prisma.company.create({
      data: req.body,
    });
    return res.status(201).json({ company });
  } catch (err) {
    return res.status(400).json({ message: err });
  }
};

export const createOneBrand = async (req: Request, res: Response) => {
  const {
    name,
    email,
    phone,
    company,
    registration_number,
    brandInstagram,
    brandTiktok,
    brandFacebook,
    brandIntersts,
    brandIndustries,
  }: {
    name: string;
    email: string;
    phone: string;
    registration_number: string;
    brandInstagram: string;
    brandTiktok: string;
    brandFacebook: string;
    company: string;
    brandIntersts: string[];
    brandIndustries: string[];
  } = req.body;
  console.log(req.body);
  try {
    const companyInfo = await prisma.company.findFirst({
      where: {
        name: company,
      },
    });
    const brand = await prisma.brand.create({
      data: {
        name: name,
        email: email,
        phone: phone,
        registration_number: registration_number,
        companyId: companyInfo?.id as string,
        instagram: brandInstagram,
        facebook: brandFacebook,
        tiktok: brandTiktok,
        intersets: brandIntersts,
        indystries: brandIndustries,
      },
    });

    return res.status(201).json({ brand });
  } catch (err) {
    return res.status(400).json({ message: err });
  }

  console.log(name);
  res.status(200).json({ name });
  // const brand = await prisma.brand.create({
  //   data: {
  //     name:name,

  //   }
  // });
  // return res.status(201).json({ brand });
};

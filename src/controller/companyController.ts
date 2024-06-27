import { Request, Response } from 'express';

import {
  // handleCreateCompany,
  handleCreateBrand,
  handleCreateCompany,
} from 'src/service/companyService';
import { PrismaClient } from '@prisma/client';
import { uploadCompanyLogo } from 'src/config/cloudStorage.config';
const prisma = new PrismaClient();

// for creating new company with brand
export const createCompany = async (req: Request, res: Response) => {
  const data = JSON.parse(req.body.data);
  const { companyLogo } = req.files as any;

  try {
    const publicURL = await uploadCompanyLogo(companyLogo.tempFilePath, companyLogo.name);
    const company = await handleCreateCompany(data, publicURL);
    return res.status(201).json({ company, message: 'A new company has been created' });
  } catch (error) {
    console.log(error);
    return res.status(400).json(error);
  }

  // try {
  //   const company = await handleCreateCompany(req.body);

  //   return res.status(201).json({ company, message: 'A new company has been created' });
  // } catch (err: any) {
  //   if (err.message.includes('exists')) {
  //     return res.status(404).json({ message: 'Company already exist' });
  //   }
  //   return res.status(400).json({ message: err });
  // }
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
    brandInstagram,
    brandTiktok,
    brandFacebook,
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
        companyId: companyInfo?.id as string,
        instagram: brandInstagram,
        facebook: brandFacebook,
        tiktok: brandTiktok,
        industries: brandIndustries,
      },
    });

    return res.status(201).json({ brand });
  } catch (err) {
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

export const editCompany = async (req: Request, res: Response) => {
  const {
    companyId,
    companyName,
    companyEmail,
    companyPhone,
    companyAddress,
    companyWebsite,
    companyAbout,
    companyObjectives,
    companyRegistrationNumber,
  } = req.body;
  try {
    const updatedCompany = await prisma.company.update({
      where: {
        id: companyId,
      },
      data: {
        name: companyName,
        about: companyAbout,
        objectives: companyObjectives,
        email: companyEmail,
        phone: companyPhone,
        address: companyAddress,
        website: companyWebsite,
        registration_number: companyRegistrationNumber,
      },
    });

    return res.status(200).json({ message: 'Succesfully updated', ...updatedCompany });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const getBrand = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const brand = await prisma.brand.findUnique({
      where: {
        id: id,
      },
      include: {
        company: true,
      },
    });
    return res.status(200).json(brand);
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const editBrand = async (req: Request, res: Response) => {
  const {
    brandId,
    brandName,
    brandEmail,
    brandPhone,
    brandInstagram,
    brandTiktok,
    brandWebsite,
    brandAbout,
    brandObjectives,
    brandIndustries,
  } = req.body;

  try {
    const updatedCompany = await prisma.brand.update({
      where: {
        id: brandId,
      },
      data: {
        name: brandName,
        description: brandAbout,
        objectives: brandObjectives,
        email: brandEmail,
        phone: brandPhone,
        instagram: brandInstagram,
        tiktok: brandTiktok,
        website: brandWebsite,
        industries: brandIndustries,
      },
    });

    return res.status(200).json({ message: 'Succesfully updated', ...updatedCompany });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const getOptions = async (_req: Request, res: Response) => {
  try {
    const company = await prisma.company.findMany({
      select: {
        id: true,
        name: true,
      },
    });

    const brand = await prisma.brand.findMany({
      select: {
        id: true,
        name: true,
      },
    });

    return res.status(200).json([...company, ...brand]);
  } catch (error) {
    return res.status(400).json(error);
  }
};

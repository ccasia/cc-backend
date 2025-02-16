import { Request, Response } from 'express';

import {
  createNewCompany,
  generateCustomId,
  generateSubscriptionCustomId,
  handleCreateBrand,
} from '@services/companyService';
import { Company, CustomPackage, Package, PrismaClient } from '@prisma/client';
import { uploadCompanyLogo } from '@configs/cloudStorage.config';
import dayjs from 'dayjs';

const prisma = new PrismaClient();

// for creating new company with brand
export const createCompany = async (req: Request, res: Response) => {
  const data = JSON.parse(req.body.data);

  const companyLogo = (req.files as { companyLogo: object })?.companyLogo as { tempFilePath: string; name: string };
  let publicURL: string | null = '';
  try {
    if (companyLogo) {
      publicURL = await uploadCompanyLogo(companyLogo.tempFilePath, companyLogo.name);
    }

    const company = await createNewCompany(data, publicURL);

    return res.status(201).json({ company, message: 'A new company has been created' });
  } catch (error) {
    console.log(error);
    if (error.message.includes('Company already exists')) {
      return res.status(400).json({ message: 'Company already exists' });
    }
    return res.status(400).json(error);
  }
};

export const getAllCompanies = async (_req: Request, res: Response) => {
  try {
    const companies = await prisma.company.findMany({
      include: {
        brand: {
          include: {
            campaign: true,
          },
        },
        pic: true,
        subscriptions: {
          include: {
            package: true,
            customPackage: true,
          },
        },
        campaign: true,
      },
    });
    return res.status(200).json(companies);
  } catch (err) {
    return res.status(400).json({ message: err });
  }
};

export const getCompanyById = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const company = await prisma.company.findUnique({
      where: {
        id: id,
      },
      include: {
        brand: {
          include: {
            campaign: true,
          },
        },
        pic: true,
        subscriptions: {
          include: {
            package: true,
            customPackage: true,
          },
        },
        campaign: {
          include: {
            campaignBrief: {
              select: {
                industries: true,
                startDate: true,
              },
            },
          },
        },
      },
    });

    if (!company) return res.status(404).json({ message: 'Company not found' });

    return res.status(200).json(company);
  } catch (err) {
    // console.log(err);
    return res.status(400).json({ message: err });
  }
};

export const createBrand = async (req: Request, res: Response) => {
  try {
    const brand = await handleCreateBrand(req.body);
    return res.status(200).json({ brand, message: 'Brand is successfully created!' });
  } catch (err) {
    return res.status(400).json({ message: err?.message });
  }
};

export const getAllBrands = async (req: Request, res: Response) => {
  try {
    const brands = await prisma.brand.findMany();
    return res.status(200).json(brands);
  } catch (err) {
    return res.status(400).json({ message: err });
  }
};

export const createOneCompany = async (req: Request, res: Response) => {
  const { name, email, phone, website } = req.body;
  try {
    const company = await prisma.company.create({
      data: {
        name,
        email,
        phone,
        website,
      },
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
    client,
    brandInstagram,
    brandTiktok,
    brandFacebook,
    brandIndustries,
  }: {
    name: string;
    email: string;
    phone: string;
    brandInstagram: string;
    brandTiktok: string;
    brandFacebook: string;
    client: Company;
    brandIndustries: string[];
  } = req.body;
  try {
    const existingClient = await prisma.company.findUnique({
      where: {
        id: client.id,
      },
    });

    if (!existingClient) {
      return res.status(404).json({ message: 'Client not found.' });
    }

    const brand = await prisma.brand.create({
      data: {
        name: name,
        email: email,
        phone: phone,
        companyId: existingClient.id,
        instagram: brandInstagram,
        facebook: brandFacebook,
        tiktok: brandTiktok,
        industries: brandIndustries,
      },
    });

    return res.status(200).json({ brand, message: 'Brand created successfully.' });
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
  } = JSON.parse(req.body.data);
  try {
    let logoURL = '';

    if (req.files && req.files.companyLogo) {
      const logo = (req.files as any).companyLogo;
      logoURL = await uploadCompanyLogo(logo.tempFilePath, logo.name);
    }

    const updateCompanyData = {
      name: companyName,
      about: companyAbout,
      objectives: companyObjectives,
      email: companyEmail,
      phone: companyPhone,
      address: companyAddress,
      website: companyWebsite,
      registration_number: companyRegistrationNumber,
      ...(logoURL && { logo: logoURL }),
    };

    const updatedCompany = await prisma.company.update({
      where: {
        id: companyId,
      },
      data: updateCompanyData,
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
        logo: true,
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

export const getBrandsByClientId = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const brands = await prisma.brand.findMany({
      where: {
        companyId: id,
      },
    });

    return res.status(200).json(brands);
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const handleLinkNewPackage = async (req: Request, res: Response) => {
  const { companyId } = req.params;
  const data = req.body;
  const { invoiceDate, validityPeriod, currency, packageId, packageType, totalUGCCredits, packageValue } = data;

  if (!companyId) return res.status(404).json({ message: 'Company ID not found.' });

  try {
    await prisma.$transaction(async (tx) => {
      let type;
      const company = await tx.company.findUnique({
        where: { id: companyId },
        include: { brand: true, subscriptions: { include: { customPackage: true, package: true } } },
      });

      if (!company) throw new Error('Company not found');

      if (!company.type && company.brand.length) {
        type = await tx.company.update({ where: { id: company.id }, data: { type: 'agency' } });
      } else {
        type = await tx.company.update({ where: { id: company.id }, data: { type: 'directClient' } });
      }

      if (!company.clientId) {
        const id = await generateCustomId(type.type);
        await tx.company.update({ where: { id: company.id }, data: { clientId: id } });
      }

      const id: string = await generateSubscriptionCustomId();
      const expiredAt = dayjs(invoiceDate).add(parseInt(validityPeriod), 'months').format();

      const subscription = company.subscriptions.find((sub) => sub.status === 'ACTIVE');

      if (subscription) {
        throw new Error('Package is still active. Please deactivate or complete the package before proceeding.');
      }

      const subscriptionData = {
        creditsUsed: 0,
        expiredAt,
        subscriptionId: id,
        currency: currency,
      };

      let customPackage: CustomPackage | null = null;
      let fixedPackage: Package | null = null;

      // Parallelize independent operations
      if (packageType === 'Custom') {
        customPackage = await tx.customPackage.create({
          data: {
            customName: packageType,
            customCredits: parseInt(totalUGCCredits),
            customPrice: parseFloat(packageValue),
            customValidityPeriod: parseInt(validityPeriod),
          },
        });
      }

      if (packageId) {
        fixedPackage = await tx.package.findUnique({
          where: { id: packageId },
        });
      }

      if (packageType !== 'Custom' && !fixedPackage) {
        throw new Error('Fixed package not found');
      }

      await tx.subscription.create({
        data: {
          companyId: company.id,
          ...(packageType === 'Custom'
            ? {
                customPackageId: customPackage!.id,
                totalCredits: customPackage?.customCredits,
                packagePrice: customPackage?.customPrice,
              }
            : {
                packageId: fixedPackage!.id,
                totalCredits: fixedPackage?.credits,
                packagePrice: parseFloat(packageValue),
              }),
          ...subscriptionData,
        },
      });
    });

    return res.status(200).json({ message: 'Successfully created' });
  } catch (error) {
    return res.status(400).json(error?.message);
  }
};

export const getUniqueClientId = async (req: Request, res: Response) => {
  const { type } = req.query;
  try {
    const id = await generateCustomId(type);

    return res.status(200).json(id);
  } catch (error) {
    return res.status(400).json(error);
  }
};

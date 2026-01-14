import { Request, Response } from 'express';

import {
  createNewCompany,
  generateCustomId,
  generateSubscriptionCustomId,
  handleCreateBrand,
} from '@services/companyService';
import { logAdminChange } from '@services/campaignServices';
import { Company, CustomPackage, Package, PrismaClient } from '@prisma/client';
import { uploadCompanyLogo } from '@configs/cloudStorage.config';
import { ClientInvitation } from '@configs/nodemailer.config';
import jwt, { Secret } from 'jsonwebtoken';
import dayjs from 'dayjs';

const prisma = new PrismaClient();

// for creating new company with brand
export const createCompany = async (req: Request, res: Response) => {
  const data = JSON.parse(req.body.data);
  const adminId = req.session.userid;

  const companyLogo = (req.files as { companyLogo: object })?.companyLogo as { tempFilePath: string; name: string };
  let publicURL: string | null = '';
  try {
    if (companyLogo) {
      publicURL = await uploadCompanyLogo(companyLogo.tempFilePath, companyLogo.name);
    }

    const company = await createNewCompany(data, publicURL);

    const adminLogMessage = `Created A New company ${company.name} `;
    logAdminChange(adminLogMessage, adminId, req);
    return res.status(201).json({ company, message: 'A new company has been created' });
  } catch (error: any) {
    console.log('Error creating company:', error);
    if (error.message.includes('Company already exists')) {
      return res.status(400).json({ message: 'Company already exists' });
    }
    return res.status(400).json({
      message: error.message || 'An unexpected error occurred while creating the company.',
    });
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

    const companiesWithSummary = companies.map((company) => {
      const activeSubscriptions = company.subscriptions.filter((sub) => sub.status === 'ACTIVE');
      const totalCredits = activeSubscriptions.reduce((sum, sub) => sum + (sub.totalCredits || 0), 0);
      const usedCredits = activeSubscriptions.reduce((sum, sub) => sum + sub.creditsUsed, 0);

      const creditSummary = {
        totalCredits,
        usedCredits,
        remainingCredits: totalCredits - usedCredits,
        activePackagesCount: activeSubscriptions.length,
        nextExpiryDate:
          activeSubscriptions.length > 0
            ? activeSubscriptions.sort((a, b) => new Date(a.expiredAt).getTime() - new Date(b.expiredAt).getTime())[0]
                .expiredAt
            : null,
      };
      return { ...company, creditSummary };
    });
    return res.status(200).json(companiesWithSummary);
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
        clients: true,
      },
    });

    if (!company) return res.status(404).json({ message: 'Company not found' });

    const activeSubscriptions = company.subscriptions.filter((sub) => sub.status === 'ACTIVE');
    const packagesWithRemainingCredits = activeSubscriptions.filter((sub) => (sub.totalCredits || 0) > sub.creditsUsed);
    packagesWithRemainingCredits.sort((a, b) => new Date(a.expiredAt).getTime() - new Date(b.expiredAt).getTime());
    const validityTrackingPackage = packagesWithRemainingCredits[0] || null;

    const totalCredits = activeSubscriptions.reduce((sum, sub) => sum + (sub.totalCredits || 0), 0);
    const usedCredits = activeSubscriptions.reduce((sum, sub) => sum + (sub.creditsUsed || 0), 0);

    const creditSummary = {
      totalCredits,
      usedCredits,
      remainingCredits: totalCredits - usedCredits,
      validityPackageExpiry: validityTrackingPackage ? validityTrackingPackage.expiredAt : null,
      activePackagesCount: activeSubscriptions.length,
      nextExpiryDate:
        activeSubscriptions.length > 0
          ? activeSubscriptions.sort((a, b) => new Date(a.expiredAt).getTime() - new Date(b.expiredAt).getTime())[0]
              .expiredAt
          : null,
    };

    return res.status(200).json({ ...company, creditSummary });
  } catch (err) {
    // console.log(err);
    return res.status(400).json({ message: err });
  }
};

export const createBrand = async (req: Request, res: Response) => {
  const adminId = req.session.userid;

  try {
    const brand = await handleCreateBrand(req.body);
    const adminLogMessage = `Created A New Brand ${brand.name} `;
    logAdminChange(adminLogMessage, adminId, req);
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
  const adminId = req.session.userid;

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
      const adminLogMessage = `Removed Company - ${company.name} `;
      logAdminChange(adminLogMessage, adminId, req);
      return res.status(200).json({ message: 'Sucessfully remove company 2' });
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
      const adminLogMessage = `Removed Company - ${company.name} `;
      logAdminChange(adminLogMessage, adminId, req);
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
  const adminId = req.session.userid;

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

    const adminLogMessage = `Updated Company - ${updatedCompany.name} `;
    logAdminChange(adminLogMessage, adminId, req);

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

      // const subscription = company.subscriptions.find((sub) => sub.status === 'ACTIVE');
      // const creditsUsed = (subscription?.totalCredits ?? 0) - (subscription?.creditsUsed ?? 0);
      // const isExpired = dayjs(subscription?.expiredAt).isBefore(dayjs(), 'date');

      // if (subscription && creditsUsed > 0 && !isExpired) {
      //   throw new Error('Package is still active. Please deactivate or complete the package before proceeding.');
      // }

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

      const subscriptionsExpiring = company.subscriptions.filter(
        (sub) => sub.status === 'ACTIVE' && dayjs(sub.expiredAt).isBefore(dayjs(), 'date'),
      );

      for (const sub of subscriptionsExpiring) {
        await tx.subscription.update({
          where: {
            id: sub.id,
          },
          data: {
            status: 'EXPIRED',
          },
        });
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
    console.log(id);

    return res.status(200).json(id);
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const clientOverview = async (req: Request, res: Response) => {
  try {
    const clients = await prisma.company.count();
    return res.status(200).json(clients);
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const activateClient = async (req: Request, res: Response) => {
  const { companyId } = req.params;
  const adminId = req.session.userid;

  try {
    // Get company information
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      include: {
        pic: true, // Get person in charge details
      },
    });

    if (!company) {
      return res.status(404).json({ message: 'Company not found' });
    }

    // Validate PIC exists
    if (!company.pic || company.pic.length === 0) {
      return res.status(400).json({ 
        message: 'PIC information is required. Please add a Person In Charge with an email before activating the client account.' 
      });
    }

    // Validate PIC has email
    if (!company.pic[0]?.email) {
      return res.status(400).json({ 
        message: 'PIC email is required. Please update the Person In Charge with a valid email before activating the client account.' 
      });
    }

    // Check if client user already exists
    const existingUser = await prisma.user.findFirst({
      where: { email: company.pic[0].email.toLowerCase() },
    });

    if (existingUser) {
      return res.status(400).json({ message: 'Client already activated' });
    }

    // Create user with client role
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: (company.pic[0].email ?? '').toLowerCase(),
          password: '', // Empty password initially
          role: 'client',
          status: 'pending',
          name: company.pic[0].name || 'Client User',
        },
      });

      // Get or create default client role
      let clientRole = await tx.role.findFirst({
        where: { name: 'Client' },
      });

      if (!clientRole) {
        clientRole = await tx.role.create({
          data: {
            name: 'Client',
          },
        });
      }

      // Generate invite token
      const inviteToken = jwt.sign(
        { id: user.id, companyId },
        process.env.SESSION_SECRET as Secret,
        { expiresIn: '24h' }, // 24 hour expiry for client setup
      );

      // Create admin record for client with Client role
      const admin = await tx.admin.create({
        data: {
          userId: user.id,
          inviteToken: inviteToken,
          roleId: clientRole.id,
          mode: 'normal',
        },
      });

      // Create client record
      const client = await tx.client.create({
        data: {
          userId: user.id,
          inviteToken: inviteToken,
          companyId: companyId, // Connect client to company
        },
      });

      return { user, admin, client, company };
    });

    // Send invitation email
    ClientInvitation(result.user.email, result.client.inviteToken!, result.company.name);

    // Log admin action
    const adminLogMessage = `Activated client for company ${company.name}`;
    logAdminChange(adminLogMessage, adminId, req);

    return res.status(200).json({
      message: 'Client activation email sent successfully',
      email: company.email,
    });
  } catch (error) {
    console.error('Client activation error:', error);
    return res.status(400).json({ message: 'Error activating client' });
  }
};

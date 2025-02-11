import { PrismaClient } from '@prisma/client';
import { createClientPackageDefault } from './packageService';

const prisma = new PrismaClient();

interface companyForm {
  companyName: string;
  companyEmail: string;
  companyPhone: string;
  companyAddress: string;
  companyWebsite: string;
  companyAbout: string;
  companyRegistrationNumber: string;
  personInChargeName: string;
  personInChargeDesignation: string;
  type: any;
  packageId: string;
  currency?: any;
  invoiceDate?: any;
  packageValue?: any;
  packageValidityPeriod?: any;
  pakcageTotalCredits?: any;
}

interface brandForm {
  brandName: string;
  brandEmail: string;
  brandPhone: string;
  brandAddress: string;
  brandWebsite: string;
  brandAbout: string;
  brandObjectives: string[];
  brandRegistrationNumber: string;
  brandService_name: string;
  brandInstagram: string;
  brandTiktok: string;
  brandFacebook: string;
  brandIntersts: string[];
  brandIndustries: string[];
  companyId: string;
}

// for creating new company with brand
export const handleCreateCompany = async (
  {
    companyName,
    companyEmail,
    companyPhone,
    companyAddress,
    companyWebsite,
    companyAbout,
    companyRegistrationNumber,
    type,
    personInChargeName,
    personInChargeDesignation,
    currency,
    packageId,
    invoiceDate,
    packageValue,
    packageValidityPeriod,
    pakcageTotalCredits,
  }: companyForm,
  publicURL?: string,
) => {
  try {
    // check if company already exists
    const id = await generateCustomId(type);

    const company = await prisma.$transaction(async (tx) => {
      const companyExist = await tx.company.findFirst({
        where: {
          OR: [
            {
              email: companyEmail,
            },
            {
              phone: companyPhone,
            },
            {
              registration_number: companyRegistrationNumber,
            },
          ],
        },
      });

      if (companyExist) {
        throw new Error('Company already exists');
      }

      const company = await tx.company.create({
        data: {
          clientId: id,
          name: companyName,
          email: companyEmail,
          phone: companyPhone,
          address: companyAddress,
          website: companyWebsite,
          about: companyAbout,
          registration_number: companyRegistrationNumber,
          logo: publicURL as string,
          pic: {
            create: {
              name: personInChargeName,
              designation: personInChargeDesignation,
            },
          },
        },
      });

      return company;
    });

    if (!company) throw new Error('Company Failed to create');

    await createClientPackageDefault(
      packageId,
      company.id,
      currency,
      invoiceDate,
      packageValue,
      packageValidityPeriod,
      pakcageTotalCredits,
    );

    return company;
  } catch (error: any) {
    throw new Error(error.message);
  }
};

// for creating new brand without company
// send company id to create brand
export const handleCreateBrand = async ({
  brandName,
  brandEmail,
  brandPhone,
  brandWebsite,
  brandObjectives,
  brandAbout,
  brandService_name,
  brandInstagram,
  brandTiktok,
  brandFacebook,
  brandIndustries,
  companyId,
}: brandForm) => {
  try {
    // check if brand already exists
    const brandExist = await prisma.brand.findFirst({
      where: {
        OR: [
          {
            email: brandEmail,
          },
          {
            phone: brandPhone,
          },
        ],
      },
    });

    if (brandExist) {
      throw new Error('An account with this email and phone number already exists.');
    }

    // check if company exists
    const companyExist = await prisma.company.findFirst({
      where: {
        id: companyId,
      },
    });

    if (!companyExist) {
      throw new Error('Company does not exists');
    }

    const brand = await prisma.brand.create({
      data: {
        name: brandName,
        email: brandEmail,
        phone: brandPhone,
        website: brandWebsite,
        companyId: companyId,
        industries: brandIndustries,
        objectives: brandObjectives,
        instagram: brandInstagram,
        facebook: brandFacebook,
        tiktok: brandTiktok,
        service_name: brandService_name,
        description: brandAbout,
      },
    });

    return brand;
  } catch (error: any) {
    throw new Error(error.message);
  }
};

export const generateCustomId = async (type: any) => {
  const firstLetter = type === 'agency' ? 'A' : 'DC';

  const lastUser = await prisma.company.findFirst({
    where: {
      clientId: {
        startsWith: firstLetter,
      },
    },
    orderBy: { updatedAt: 'desc' }, // Get the latest ID
  });

  let nextId = `${firstLetter}01`; // Default if no user exists

  if (lastUser?.clientId && lastUser?.clientId.includes(firstLetter)) {
    const lastNumber = parseInt(lastUser?.clientId.slice(type === 'agency' ? 1 : 2), 10); // Extract number part
    const nextNumber = lastNumber + 1;
    nextId = `${firstLetter}${nextNumber.toString().padStart(2, '0')}`; // Format to A01, A02, etc.
  }

  return nextId;
};

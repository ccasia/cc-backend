import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface companyForm {
  companyName: string;
  companyEmail: string;
  companyPhone: string;
  companyAddress: string;
  companyWebsite: string;
  companyAbout: string;
  companyObjectives: string[];
  companyRegistrationNumber: string;
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
export const handleCreateCompany = async ({
  companyName,
  companyEmail,
  companyPhone,
  companyAddress,
  companyWebsite,
  companyAbout,
  companyObjectives,
  companyRegistrationNumber,
}: companyForm) => {
  try {
    // check if company already exists
    const companyExist = await prisma.company.findFirst({
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

    const company = await prisma.company.create({
      data: {
        name: companyName,
        email: companyEmail,
        phone: companyPhone,
        address: companyAddress,
        website: companyWebsite,
        about: companyAbout,
        objectives: companyObjectives,
        registration_number: companyRegistrationNumber,
      },
    });

    return { company };
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
      throw new Error('Brand already exists');
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
        indystries: brandIndustries,
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
    console.log(error);
    throw new Error(error.message);
  }
};

// for creating supBrand

// for creating supsupbrand

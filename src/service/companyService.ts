import { CustomPackage, Package, PrismaClient, Subscription } from '@prisma/client';
import dayjs from 'dayjs';
// import { createClientPackageDefault } from './packageService';

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

interface CompanyForm {
  invoiceDate: string;
  validityPeriod: string;
  totalUGCCredits: string;
  packageValue: string;
  packageType: string;
  currency: string;
  companyName: string;
  companyEmail: string;
  companyPhone: string;
  companyAddress: string;
  companyWebsite: string;
  companyAbout: string;
  companyRegistrationNumber: string;
  type: 'directClient' | 'agency';
  personInChargeName: string;
  personInChargeDesignation: string;
  personInChargeEmail?: string;
  packageId?: string;
  companyID: string;
}

// // for creating new company with brand
// export const handleCreateCompany = async (
//   {
//     companyName,
//     companyEmail,
//     companyPhone,
//     companyAddress,
//     companyWebsite,
//     companyAbout,
//     companyRegistrationNumber,
//     type,
//     personInChargeName,
//     personInChargeDesignation,
//     currency,
//     packageId,
//     invoiceDate,
//     packageValue,
//     packageValidityPeriod,
//     pakcageTotalCredits,
//   }: companyForm,
//   publicURL?: string,
// ) => {
//   try {
//     // check if company already exists
//     const id = await generateCustomId(type);

//     const company = await prisma.$transaction(async (tx) => {
//       const companyExist = await tx.company.findFirst({
//         where: {
//           OR: [
//             {
//               email: companyEmail,
//             },
//             {
//               phone: companyPhone,
//             },
//             {
//               registration_number: companyRegistrationNumber,
//             },
//           ],
//         },
//       });

//       if (companyExist) {
//         throw new Error('Company already exists');
//       }

//       const company = await tx.company.create({
//         data: {
//           clientId: id,
//           name: companyName,
//           email: companyEmail,
//           phone: companyPhone,
//           address: companyAddress,
//           website: companyWebsite,
//           about: companyAbout,
//           registration_number: companyRegistrationNumber,
//           logo: publicURL as string,
//           pic: {
//             create: {
//               name: personInChargeName,
//               designation: personInChargeDesignation,
//             },
//           },
//         },
//       });

//       return company;
//     });

//     if (!company) throw new Error('Company Failed to create');

//     // await createClientPackageDefault(
//     //   packageId,
//     //   company.id,
//     //   currency,
//     //   invoiceDate,
//     //   packageValue,
//     //   packageValidityPeriod,
//     //   pakcageTotalCredits,
//     // );

//     return company;
//   } catch (error: any) {
//     throw new Error(error.message);
//   }
// };

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
    orderBy: { clientId: 'desc' }, // Get the latest ID
  });

  let nextId; // Default if no user exists

  if (lastUser?.clientId) {
    const prefixLength = firstLetter.length;
    const lastNumber = parseInt(lastUser?.clientId.slice(prefixLength), 10); // Extract number part
    const nextNumber = lastNumber + 1;
    nextId = `${firstLetter}${nextNumber.toString().padStart(4, '0')}`; // Format to A0001, A00002, etc.
  } else {
    nextId = `${firstLetter}${'1'.toString().padStart(4, '0')}`;
  }

  return nextId;
};

export const generateSubscriptionCustomId = async () => {
  const lastSubscription = await prisma.subscription.findFirst({
    orderBy: {
      subscriptionId: 'desc',
    },
    select: {
      subscriptionId: true,
    },
  });

  let newIdNumber = 1; // Default if no records exist
  if (lastSubscription && lastSubscription.subscriptionId) {
    const lastNumber = parseInt(lastSubscription.subscriptionId.replace('P', ''), 10);
    newIdNumber = lastNumber + 1;
  }

  return `P${newIdNumber.toString().padStart(4, '0')}`;
};

// New versions
export const createNewCompany = async (data: CompanyForm, publicURL?: string) => {
  const {
    invoiceDate,
    validityPeriod,
    totalUGCCredits,
    packageType,
    packageValue,
    companyName,
    companyAbout,
    companyAddress,
    companyEmail,
    companyPhone,
    companyRegistrationNumber,
    companyWebsite,
    type,
    personInChargeDesignation,
    personInChargeName,
    personInChargeEmail,
    packageId,
    currency,
    companyID,
  } = data;

  try {
    return await prisma.$transaction(async (tx) => {
      const id: string = await generateSubscriptionCustomId();
      const clientId = await generateCustomId(type);
      const expiredAt = dayjs(invoiceDate).add(parseInt(validityPeriod), 'months').format();
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

      const company = await tx.company.create({
        data: {
          type,
          clientId: companyID,
          name: companyName,
          about: companyAbout,
          address: companyAddress,
          email: companyEmail,
          phone: companyPhone,
          registration_number: companyRegistrationNumber,
          website: companyWebsite,
          logo: publicURL,
          pic: {
            create: {
              name: personInChargeName,
              designation: personInChargeDesignation,
              email: personInChargeEmail,
            },
          },
          subscriptions: {
            create: {
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
          },
        },
      });

      return company;
    });
  } catch (error) {
    throw new Error(`Failed to create company: ${error.message}`);
  }
};

export const getRemainingCredits = async (clientId: string): Promise<number | null> => {
  try {
    const client = await prisma.company.findUnique({
      where: {
        id: clientId,
      },
      select: {
        subscriptions: {
          where: { status: 'ACTIVE' },
          select: {
            totalCredits: true,
            creditsUsed: true,
            // customPackage: true,
            // package: true,
          },
        },
      },
    });

    if (!client) return null;

    if (!client.subscriptions || client.subscriptions.length === 0) {
      throw new Error('No active subscription or invalid total credits');
    }

    const totalCredits = client.subscriptions.reduce((sum, sub) => sum + (sub.totalCredits || 0), 0);
    const usedCredits = client.subscriptions.reduce((sum, sub) => sum + sub.creditsUsed, 0);
    const remainingCredits = totalCredits - usedCredits;

    // const activeSubscription = client.subscriptions[0];

    // if (!activeSubscription || typeof activeSubscription.totalCredits !== 'number') {
    //   throw new Error('No active subscription or invalid total credits');
    // }

    // Calculate remaining credits based on subscription's creditsUsed field
    // const remainingCredits = activeSubscription.totalCredits - activeSubscription.creditsUsed;

    return Math.max(0, remainingCredits); // Ensure we don't return negative credits
  } catch (error) {
    throw new Error(error);
  }
};

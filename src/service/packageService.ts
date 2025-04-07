// import { Prisma, PackageType, PrismaClient } from '@prisma/client';
// import dayjs from 'dayjs';
// import { Currencies } from 'xero-node';

// const prisma = new PrismaClient();

// interface DefalutPackage {
//   type: PackageType;
//   valueSGD: number;
//   valueMYR: number;
//   totalCredits: number;
//   creditsUtilized?: number;
//   availableCredits?: number;
//   validityPeriod: number;
//   invoiceDate?: Date;
//   remarks?: any;
//   invoiceLink?: string;
//   packageId?: string;
// }

// // create function to create defalut packages
// const createDefualtPackage = async ({ type, valueMYR, valueSGD, totalCredits, validityPeriod }: DefalutPackage) => {
//   if (!type || !valueMYR || !valueSGD || !totalCredits || !validityPeriod) {
//     throw new Error('All fields are required');
//   }
//   try {
//     const createdPackage = await prisma.packages.create({
//       data: {
//         type,
//         valueMYR,
//         valueSGD,
//         totalUGCCredits: totalCredits,
//         validityPeriod,
//       },
//     });
//     return createdPackage;
//   } catch (error) {
//     console.log(error);
//   }
// };
// // function to edit default packages
// const editDefalutPackage = async (
//   packageId: string,
//   { type, valueMYR, valueSGD, totalCredits, creditsUtilized, availableCredits, validityPeriod }: DefalutPackage,
// ) => {
//   if (!packageId) {
//     throw new Error('incorrect information please check package data');
//   }
//   try {
//     const editedPackage = await prisma.packages.update({
//       where: {
//         id: packageId,
//       },
//       data: {
//         type,
//         valueMYR,
//         valueSGD,
//         totalUGCCredits: totalCredits,
//         validityPeriod,
//       },
//     });
//     return editedPackage;
//   } catch (error) {
//     console.log(error);
//   }
// };
// // function to fetch all defalut packages
// const fetchAllDefalutPackages = async () => {
//   try {
//     const packages = await prisma.packages.findMany();
//     return packages;
//   } catch (error) {
//     console.log(error);
//   }
// };

// // function to copy default pakage information to user package on clinet creation or adding
// const createClientPackageDefault = async (
//   packageId: string,
//   companyId: string,
//   currency: any,
//   invoiceDate?: Date,
//   packageValue?: any,
//   packageValidityPeriod?: any,
//   pakcageTotalCredits?: any,
//   remarks?: any,
//   invoiceLink?: string,
// ) => {
//   try {
//     if (!packageId) {
//       throw new Error('incorrect information please check package data');
//     }

//     return await prisma.$transaction(async (tx) => {
//       const defaultPackage = await tx.packages.findUnique({
//         where: {
//           id: packageId,
//         },
//       });

//       if (!defaultPackage) {
//         throw new Error('no packages found');
//       }

//       // const getBrand = await tx.brand.findUnique({
//       //   where: {
//       //     id: clientId,
//       //   },
//       // });

//       // if (!getBrand) {
//       //   throw new Error('Brand information is incorrect');
//       // }

//       if (defaultPackage.type === 'Custom') {
//         const createClientPackage = await tx.packagesClient.create({
//           data: {
//             companyId: companyId,
//             type: defaultPackage.type as PackageType,
//             value: parseInt(packageValue),
//             currency: currency,
//             totalUGCCredits: parseInt(pakcageTotalCredits),
//             creditsUtilized: 0,
//             availableCredits: parseInt(pakcageTotalCredits),
//             validityPeriod: parseInt(packageValidityPeriod),
//             invoiceDate: invoiceDate || null,
//             Remarks: remarks || null,
//             invoiceLink: invoiceLink || null,
//             packageId: defaultPackage.id,
//             states: 'active',
//           },
//         });
//       } else {
//         const createClientPackage = await tx.packagesClient.create({
//           data: {
//             companyId: companyId,
//             type: defaultPackage.type as PackageType,
//             value: currency === 'MYR' ? defaultPackage.valueMYR : defaultPackage.valueSGD,
//             currency: currency,
//             totalUGCCredits: defaultPackage.totalUGCCredits,
//             creditsUtilized: 0,
//             availableCredits: defaultPackage.totalUGCCredits,
//             validityPeriod: defaultPackage.validityPeriod,
//             invoiceDate: invoiceDate || null,
//             Remarks: remarks || null,
//             invoiceLink: invoiceLink || null,
//             packageId: defaultPackage.id,
//             states: 'active',
//           },
//         });
//       }
//     });
//   } catch (error) {
//     console.log(error);
//     throw new Error(error);
//   }
// };

// // function to edit clinet
// // add funtion to fetch active packages only
// const editClientPackage = async (clientId: any, data: DefalutPackage, value: any) => {
//   if (!clientId) {
//     throw new Error('incorrect information please check package data');
//   }
//   try {
//     const editedPackage = await prisma.packagesClient.update({
//       where: {
//         companyId: clientId,
//         states: 'active',
//       },
//       data: {
//         type: 'Custom',
//         value,
//         totalUGCCredits: data.totalCredits,
//         creditsUtilized: data.creditsUtilized,
//         availableCredits: data.availableCredits,
//         validityPeriod: data.validityPeriod,
//         invoiceDate: data.invoiceDate || null,
//         Remarks: data.remarks || null,
//         invoiceLink: data.invoiceLink || null,
//       },
//     });
//     return editedPackage;
//   } catch (error) {
//     console.log(error);
//   }
// };
// // function to get client package
// const getClientPackage = async (clientId: string) => {
//   if (!clientId) {
//     throw new Error('incorrect information please check package data');
//   }
//   try {
//     const clientPackage = await prisma.packagesClient.findUnique({
//       where: {
//         companyId: clientId,
//         states: 'active',
//       },
//     });
//     return clientPackage;
//   } catch (error) {
//     console.log(error);
//   }
// };

// const getPackagesHistory = async (clientId: string) => {
//   if (!clientId) {
//     throw new Error('incorrect information please check package data');
//   }
//   console.log('pakcage history page');
//   try {
//     const clientPackage = await prisma.packagesClient.findMany();
//     return clientPackage;
//   } catch (error) {
//     console.log(error);
//   }
// };
// // create a function to take package type and create the client package by fetching the package by type also it handles the custom package creting by recieving json object with all the required data for the pacakge
// const createCustomPackage = async (
//   clientId: string,
//   packageId: string,
//   currency: any,
//   {
//     valueMYR,
//     valueSGD,
//     totalCredits,
//     creditsUtilized,
//     availableCredits,
//     validityPeriod,
//     invoiceDate,
//     invoiceLink,
//     remarks,
//   }: DefalutPackage,
// ) => {
//   try {
//     return await prisma.$transaction(async (tx) => {
//       const defaultPackage = await tx.packages.findUnique({
//         where: {
//           id: packageId,
//         },
//       });

//       if (!defaultPackage || defaultPackage.type !== 'Custom') {
//         throw new Error('no packages found');
//       }

//       const getBrand = await tx.brand.findUnique({
//         where: {
//           id: clientId,
//         },
//       });

//       if (!getBrand) {
//         throw new Error('Brand information is incorrect');
//       }

//       const createClientPackage = await tx.packagesClient.create({
//         data: {
//           type: 'Custom' as PackageType,
//           currency,
//           value: currency === 'MYR' ? valueMYR : valueSGD,
//           totalUGCCredits: totalCredits,
//           creditsUtilized,
//           availableCredits,
//           validityPeriod,
//           invoiceDate: invoiceDate || null,
//           Remarks: remarks || null,
//           invoiceLink: invoiceLink || null,
//           companyId: getBrand.id,
//           packageId: defaultPackage.id,
//           states: 'active',
//         },
//       });
//     });
//   } catch (error) {
//     console.log(error);
//   }
// };
// // after creator is assigend to campiagn system should decremnt the one credit per creator

// const applyCreditCampiagn = async (clientId: string, appliedCredits: number) => {
//   if (!clientId || !appliedCredits) {
//     throw new Error('Please complete all the input fields');
//   }
//   try {
//     const clientPackage = await prisma.packagesClient.update({
//       where: {
//         companyId: clientId,
//         states: 'active',
//       },
//       data: {
//         creditsUtilized: {
//           increment: appliedCredits,
//         },
//         availableCredits: {
//           decrement: appliedCredits,
//         },
//       },
//     });
//     return clientPackage;
//   } catch (error) {
//     console.log(error);
//   }
// };
// // add function to check if the package is expired or not
// const decreamentOneCreadit = async (clientId: string, pakcageId: string) => {
//   try {
//     if (!clientId) {
//       throw new Error('incorrect information please check package data');
//     }
//     const clientPackage = await prisma.packagesClient.update({
//       where: {
//         companyId: clientId,
//         packageId: pakcageId,
//         states: 'active',
//       },
//       data: {
//         creditsUtilized: {
//           increment: 1,
//         },
//         availableCredits: {
//           decrement: 1,
//         },
//       },
//     });
//   } catch (error) {
//     console.log(error);
//   }
// };

// // add funtion to decremnt one ugc credit from campiagn credits
// const decreamentCreditCampiagn = async (campiagnId: string) => {
//   if (!campiagnId) {
//     throw new Error('missing campiagn Information');
//   }

//   try {
//     const updatedCampiagn = await prisma.campaign.update({
//       where: {
//         id: campiagnId,
//         status: 'ACTIVE',
//       },
//       data: {
//         campaignCredits: {
//           decrement: 1,
//         },
//       },
//     });
//     return updatedCampiagn;
//   } catch (error) {
//     console.log(error);
//   }
// };

// export {
//   createDefualtPackage,
//   editDefalutPackage,
//   fetchAllDefalutPackages,
//   createClientPackageDefault,
//   editClientPackage,
//   getClientPackage,
//   createCustomPackage,
//   decreamentOneCreadit,
//   getPackagesHistory,
//   applyCreditCampiagn,
//   decreamentCreditCampiagn,
// };

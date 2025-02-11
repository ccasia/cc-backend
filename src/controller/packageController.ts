import { Prisma, PackageType, PrismaClient } from '@prisma/client';
import { Request, Response } from 'express';

import {
  editDefalutPackage,
  fetchAllDefalutPackages,
  createClientPackageDefault,
  editClientPackage,
  getClientPackage,
  createCustomPackage,
  getPackagesHistory,
} from '@services/packageService';
const prisma = new PrismaClient();

interface DefalutPackage {
  type: PackageType;
  valueSGD: number;
  valueMYR: number;
  totalCredits: number;
  creditsUtilized?: number;
  availableCredits?: number;
  validityPeriod: number;
  invoiceDate?: Date;
  remarks?: any;
  invoiceLink?: string;
}

const pakcagesArray: DefalutPackage[] = [
  {
    type: 'Trail',
    valueMYR: 2800,
    valueSGD: 3100,
    totalCredits: 5,
    validityPeriod: 1,
  },
  {
    type: 'Basic',
    valueMYR: 8000,
    valueSGD: 8900,
    totalCredits: 15,
    validityPeriod: 2,
  },
  {
    type: 'Essential',
    valueMYR: 15000,
    valueSGD: 17500,
    totalCredits: 30,
    validityPeriod: 3,
  },
  {
    type: 'Pro',
    valueMYR: 23000,
    valueSGD: 29000,
    totalCredits: 50,
    validityPeriod: 5,
  },
  {
    type: 'Custom',
    valueMYR: 1,
    valueSGD: 1,
    totalCredits: 1,
    validityPeriod: 1,
  },
];

export const createPackages = async (req: Request, res: Response) => {
  // create package seeding function for creating the intialized formation with the cult creative information
  try {
    await Promise.all(
      pakcagesArray.map(async (item) => {
        await prisma.packages.create({
          data: {
            type: item.type,
            valueMYR: item.valueMYR,
            valueSGD: item.valueSGD,
            totalUGCCredits: item.totalCredits,
            validityPeriod: item.validityPeriod,
          },
        });
      }),
    );
    res.status(200).send('packages created');
  } catch (error) {
    console.log(error);
    res.status(500).send('error creating packages');
  }
};

// create function to edit the default package
export const editDefaultPackage = async (req: Request, res: Response) => {
  const { packageId, type, valueMYR, valueSGD, totalCredits, validityPeriod } = req.body;
  if (!packageId) {
    res.status(400).send('incorrect information please check package data');
  }
  try {
    const editedPackage = await editDefalutPackage(packageId, {
      type,
      valueMYR,
      valueSGD,
      totalCredits,
      validityPeriod,
    });
    res.status(200).json(editedPackage);
  } catch (error) {
    console.log(error);
    res.status(500).send('error editing package');
  }
};
// create function to fetch all packages
export const fetchAllPackages = async (req: Request, res: Response) => {
  try {
    const packages = await fetchAllDefalutPackages();
    res.status(200).json(packages);
  } catch (error) {
    console.log(error);
    res.status(500).send('error fetching packages');
  }
};
// create function to create client package
export const createClientPackage = async (req: Request, res: Response) => {
  const { clientId, packageId, invoiceDate, remarks, invoiceLink } = req.body;
  if (!clientId || !packageId) {
    res.status(400).send('incorrect information please check package data');
  }
  try {
    const createdPackage = await createClientPackageDefault(clientId, packageId, invoiceDate, remarks, invoiceLink);
    res.status(200).json(createdPackage);
  } catch (error) {
    console.log(error);
    res.status(500).send('error creating client package');
  }
};
// create function to edit client package
// this will cause error due to type error
export const editClientPackageCont = async (req: Request, res: Response) => {
  const { clinetId, data, value } = req.body;
  if (!clinetId || !data) {
    res.status(400).send('incorrect information please check package data');
  }
  try {
    const editedPackage = await editClientPackage(clinetId, data, value);
    res.status(200).json(editedPackage);
  } catch (error) {
    console.log(error);
    res.status(500).send('error editing package');
  }
};
// create function to get client package
export const getClientPackageCont = async (req: Request, res: Response) => {
  const { clinetId } = req.body;
  if (!clinetId) {
    res.status(400).send('incorrect information please check package data');
  }
  try {
    const clientPackage = await getClientPackage(clinetId);
    res.status(200).json(clientPackage);
  } catch (error) {
    console.log(error);
    res.status(500).send('error fetching package');
  }
};

export const clientPackageHistory = async (req: Request, res: Response) => {
  const { id } = req.params;

  
  if (!id) {
    throw new Error('incorrect information please check package data');
  }
  console.log('pakcage history page');
  try {
    const clientPackage = await prisma.packagesClient.findMany({
      where: {
        companyId: id,
      },
    });

    const currentDate = new Date();
    for (let item of clientPackage) {
      const dateVal = new Date(item.invoiceDate as Date);
      const validityPeriodInMs = item.validityPeriod * 24 * 60 * 60 * 1000; // Convert validity period to milliseconds
      const expirationDate = new Date(dateVal.getTime() + validityPeriodInMs);

      // Check if the current date is after the expiration date
      if (currentDate > expirationDate && item.states !== 'inactive') {
        // Update the package status to 'inactive'
        await prisma.packagesClient.update({
          where: {
            id: item.id,
          },
          data: {
            states: 'inactive',
          },
        });
      }
    }

    const updatedPackages = await prisma.packagesClient.findMany({
      where: {
        companyId: id,
      },
    });

    return res.status(200).json(updatedPackages);
  } catch (error) {
    console.log(error);
  }
};
// create function to create custom package
export const createCustomPackageCont = async (req: Request, res: Response) => {
  const { clientId, packageId, data, currency } = req.body;
  if (!clientId || !packageId || !data) {
    res.status(400).send('incorrect information please check package data');
  }
  try {
    const createdPackage = await createCustomPackage(clientId, packageId, data, currency);
    res.status(200).json(createdPackage);
  } catch (error) {
    console.log(error);
    res.status(500).send('error creating custom package');
  }
};

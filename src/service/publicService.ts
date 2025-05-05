import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const generateCampaignAccessService = async (campaignId: string, expiryInDays = 7) => {
  const password = crypto
    .randomBytes(8)
    .toString('base64')
    .replace(/[^a-zA-Z0-9]/g, '');

  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + expiryInDays);

  // Check if a record exists with the given campaignId
  const existingAccess = await prisma.publicAccess.findFirst({
    where: { campaignId },
  });

  if (existingAccess) {
    // Update the existing record
    await prisma.publicAccess.update({
      where: { id: existingAccess.id },
      data: { password, expiryDate },
    });
  } else {
    // Create a new record
    await prisma.publicAccess.create({
      data: { campaignId, password, expiryDate },
    });
  }

  const url = `${process.env.BASE_EMAIL_URL}/public/access/${campaignId}`;
  return { url, password };
};

export const validateCampaignPasswordService = async (campaignId: string, inputPassword: string) => {
  // Fetch the most recent record for the given campaignId
  const access = await prisma.publicAccess.findFirst({
    where: { campaignId },
    orderBy: { createdAt: 'desc' }, // Ensure we're checking the latest record
  });

  if (!access) throw new Error('Campaign not found');
  if (new Date() > access.expiryDate) throw new Error('Password has expired');
  if (access.password !== inputPassword) throw new Error('Invalid password');

  return true;
};

export const regenerateCampaignPasswordService = async (campaignId: string, expiryInMinutes: number) => {
  // Fetch the most recent record for the given campaignId
  const existingAccess = await prisma.publicAccess.findFirst({
    where: { campaignId },
    orderBy: { createdAt: 'desc' },
  });

  if (!existingAccess) {
    throw new Error('No existing password found for this campaign');
  }

  const newPassword = crypto
    .randomBytes(8)
    .toString('base64')
    .replace(/[^a-zA-Z0-9]/g, '');

  const expiryDate = new Date();
  expiryDate.setMinutes(expiryDate.getMinutes() + expiryInMinutes);

  // Update the most recent record
  await prisma.publicAccess.update({
    where: { id: existingAccess.id }, // Use the unique ID of the record
    data: { password: newPassword, expiryDate },
  });

  const url = `${process.env.BASE_EMAIL_URL}/public/access/${campaignId}`;
  return { url, password: newPassword };
};

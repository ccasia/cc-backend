import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const assignTask = async (userId: string, campaignId: string, campaignTimelineId: string) => {
  try {
    await prisma.campaignTask.create({
      data: {
        userId: userId,
        campaignId: campaignId,
        campaignTimelineId: campaignTimelineId,
      },
    });
  } catch (error) {
    return error;
  }
};

// `campaign` and `admin` are the types of `Campaign` and `Admin` in the Prisma schema
export const logChange = async (message: string, campaignId: string, adminId: string) => {
  try {
    await prisma.campaignLog.create({
      data: {
        message: message,
        campaignId: campaignId,
        adminId: adminId,
      },
    });
  } catch (error) {
    return error;
  }
};

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const assignTask = async (userId: string, campaignId: string, campaignTimelineId: string) => {
  try {
    await prisma.campaignTimelineTask.create({
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

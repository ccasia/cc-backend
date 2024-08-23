import { PrismaClient } from '@prisma/client';
import { Request } from 'express';

const prisma = new PrismaClient();

// export const assignTask = async (userId: string, campaignId: string, campaignTimelineId: string) => {
//   try {
//     await prisma.campaignTask.create({
//       data: {
//         userId: userId,
//         campaignId: campaignId,
//         campaignTimelineId: campaignTimelineId,
//       },
//     });
//   } catch (error) {
//     return error;
//   }
// };

// `req` is for the admin ID
export const logChange = async (message: string, campaignId: string, req: Request) => {
  const adminId = req.session.userid;
  if (adminId === undefined) {
    throw new Error('Admin ID is undefined');
  }

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

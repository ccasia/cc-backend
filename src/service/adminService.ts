import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const handleDeleteAdminById = async (id: string) => {
  try {
    const admin = await prisma.user.findUnique({
      where: { id: id },
      include: { admin: true },
    });

    if (!admin) throw new Error('Admin not found.');

    await prisma.$transaction([
      prisma.message.deleteMany({ where: { senderId: id } }),
      prisma.userThread.deleteMany({ where: { userId: id } }),
      prisma.unreadMessage.deleteMany({ where: { userId: id } }),
      prisma.seenMessage.deleteMany({ where: { userId: id } }),
      prisma.bookMarkCampaign.deleteMany({ where: { userId: id } }),
      prisma.campaignLog.deleteMany({ where: { adminId: id } }),
      prisma.campaignTaskAdmin.deleteMany({ where: { userId: id } }),
      prisma.feedback.deleteMany({ where: { adminId: id } }),
      prisma.notification.deleteMany({ where: { userId: id } }),
      prisma.userNotification.deleteMany({ where: { userId: id } }),
      prisma.resetPasswordToken.deleteMany({ where: { userId: id } }),
      prisma.invoice.deleteMany({ where: { adminId: id } }),
      prisma.campaignAdmin.deleteMany({ where: { adminId: admin.admin?.id } }),
    ]);

    await prisma.admin.delete({
      where: {
        userId: id,
      },
    });

    await prisma.user.delete({
      where: { id: id },
    });

    // const res = await prisma.$transaction([
    //   prisma.adminPermissionModule.deleteMany({
    //     where: {
    //       admin: {
    //         userId: id,
    //       },
    //     },
    //   }),
    //   prisma.campaignAdmin.deleteMany({
    //     where: {
    //       admin: {
    //         userId: id,
    //       },
    //     },
    //   }),
    //   prisma.admin.delete({
    //     where: {
    //       userId: id,
    //     },
    //   }),
    //   prisma.user.delete({
    //     where: {
    //       id,
    //     },
    //   }),
    //   prisma.unreadMessage.deleteMany({
    //     where: {
    //       userId: id,
    //     },
    //   }),
    // ]);
    // return res;
  } catch (error) {
    console.log(error);
    return error;
  }
};

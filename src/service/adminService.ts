import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const handleDeleteAdminById = async (id: string) => {
  try {
    const admin = await prisma.user.findUnique({
      where: { id: id },
      include: { admin: true },
    });

    if (!admin) throw new Error('Admin not found.');

    const adminProfileId = admin.admin?.id;

    await prisma.$transaction(async (tx) => {
      await tx.message.deleteMany({ where: { senderId: id } });
      await tx.userThread.deleteMany({ where: { userId: id } });
      await tx.unreadMessage.deleteMany({ where: { userId: id } });
      await tx.seenMessage.deleteMany({ where: { userId: id } });
      await tx.bookMarkCampaign.deleteMany({ where: { userId: id } });
      await tx.campaignTaskAdmin.deleteMany({ where: { userId: id } });
      await tx.feedback.deleteMany({ where: { adminId: id } });
      await tx.notification.deleteMany({ where: { userId: id } });
      await tx.userNotification.deleteMany({ where: { userId: id } });
      await tx.resetPasswordToken.deleteMany({ where: { userId: id } });

      if (adminProfileId) {
        await tx.campaignAdmin.deleteMany({ where: { adminId: adminProfileId } });
        await tx.admin.delete({ where: { userId: id } });
      }

      await tx.user.delete({ where: { id } });
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

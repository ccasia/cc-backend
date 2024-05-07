import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const handleDeleteAdminById = async (id: string) => {
  try {
    const res = await prisma.$transaction([
      prisma.admin.delete({
        where: {
          userId: id,
        },
      }),
      prisma.user.delete({
        where: {
          id,
        },
      }),
    ]);
    return res;
  } catch (error) {
    return error;
  }
};

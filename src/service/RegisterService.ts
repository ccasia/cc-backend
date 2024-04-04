import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const registerUser = async (name: string) => {
  await prisma.user.create({
    data: {
      name,
    },
  });
};

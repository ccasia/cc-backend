import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface User {
  email: string;
  password: string;
}

export const registerUser = async ({ email, password }: User) => {
  await prisma.user.create({
    data: {
      email: email,
      password: password,
    },
  });
};

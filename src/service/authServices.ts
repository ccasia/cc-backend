import { prisma } from '@/src/prisma/prisma';

interface ChangePassword {
  userId: string;
  latestPassword: string;
}

export const handleChangePassword = async ({ userId, latestPassword }: ChangePassword) => {
  try {
    const user = await prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        password: latestPassword,
      },
    });

    return user;
  } catch (error) {
    //console.log(error);
    throw new Error('Error');
  }
};

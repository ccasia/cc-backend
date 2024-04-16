import { PrismaClient } from '@prisma/client';
// import passport from 'passport';

const prisma = new PrismaClient();

interface User {
  email: string;
  password: string;
}

interface SuperAdmin {
  name: string;
  designation: string;
  country: string;
  phoneNumber: string;
}

export const registerUser = async ({ email, password }: User) => {
  await prisma.user.create({
    data: {
      email: email,
      password: password,
    },
  });
};

export const registerSuperadmin = async (
  { email, password }: User,
  { name, designation, country, phoneNumber }: SuperAdmin,
) => {
  try {
    const user = await prisma.user.create({
      data: {
        email: email,
        password: password,
      },
    });

    await prisma.admin.create({
      data: {
        userId: user?.id,
        name: name,
        designation: designation,
        country: country,
        phoneNumber: phoneNumber,
        status: 'active',
        mode: 'god',
      },
    });
  } catch (error) {
    console.log(error);
  }
};

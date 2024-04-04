/* eslint-disable no-unused-vars */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface AdminProfile {
  name: string;
  email: string;
  password: string;
  photoURL: string;
  designation: string;
  country: string;
  phoneNumber: string;
}

export const updateUser = async ({
  name,
  email,
  password,
  photoURL,
  designation,
  country,
  phoneNumber,
}: AdminProfile) => {
  try {
    const data = await prisma.admin.update({
      where: {
        // Replace with admin id
        id: 1,
      },
      data: {
        name,
        designation,
        country,
        phoneNumber,
        photoURL,
        user: {
          update: {
            email,
            password,
          },
        },
      },
    });
    return data;
  } catch (error) {
    return error;
  }
};

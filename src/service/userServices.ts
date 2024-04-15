/* eslint-disable no-unused-vars */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface AdminProfile {
  userId: string;
  name: string;
  email: string;
  password: string;
  photoURL: string;
  designation: string;
  country: string;
  phoneNumber: string;
}

export const updateUser = async ({
  userId,
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
        id: userId,
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

export const getUser = async (id: string) => {
  const user = await prisma.user.findUnique({
    where: {
      id: id,
    },
  });
  return user;
};

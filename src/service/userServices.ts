/* eslint-disable no-unused-vars */
import { PrismaClient } from '@prisma/client';
// import { AdminInvite } from 'src/config/nodemailer.config';
import jwt, { Secret } from 'jsonwebtoken';
import bcrypt from 'bcrypt';

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
  const user = await prisma.admin.findUnique({
    where: {
      userId: id,
    },
    include: {
      user: true,
    },
  });
  return user;
};

export const handleGetAdmins = async (userid: string) => {
  try {
    const admins = await prisma.admin.findMany({
      where: {
        NOT: {
          userId: userid,
        },
      },
      include: {
        user: true,
      },
    });
    return admins;
  } catch (error) {
    return error;
  }
};

export const createNewAdmin = async (email: string) => {
  try {
    const user = await prisma.user.create({
      data: {
        email: email,
        role: 'admin',
      },
    });

    const inviteToken = jwt.sign({ id: user?.id }, process.env.SESSION_SECRET as Secret, { expiresIn: '1h' });

    const admin = await prisma.admin.create({
      data: {
        userId: user.id,
        inviteToken: inviteToken,
      },
    });

    return { user, admin };
  } catch (error) {
    throw new Error(error as any);
  }
};

export const findUserByEmail = async (email: string) => {
  const user = await prisma.user.findUnique({
    where: {
      email: email,
    },
  });
  return user;
};

export const updateNewAdmin = async (adminData: any) => {
  const {
    data: { name, designation, country, phoneNumber, password },
    userId,
  } = adminData;

  const hashedPassword = await bcrypt.hash(password, 10);

  try {
    const res = await prisma.$transaction([
      prisma.user.update({
        where: {
          id: userId,
        },
        data: {
          password: hashedPassword,
        },
      }),
      prisma.admin.update({
        where: {
          userId: userId,
        },
        data: {
          name,
          designation,
          country,
          phoneNumber,
          inviteToken: '',
          status: 'active',
        },
      }),
    ]);
    return res;
  } catch (error) {
    throw new Error(error as string);
  }
};

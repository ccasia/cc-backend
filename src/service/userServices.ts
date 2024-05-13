/* eslint-disable no-unused-vars */
import { Mode, PrismaClient } from '@prisma/client';
// import { AdminInvite } from 'src/config/nodemailer.config';
import jwt, { Secret } from 'jsonwebtoken';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

interface AdminProfile {
  userId: string;
  name: string;
  email: string;
  password: string;
  designation: string;
  country: string;
  phoneNumber: string;
  adminRole: string;
  role: string;
  mode: string;
  status: any;
}

export const updateAdmin = async (
  { userId, name, email, designation, country, phoneNumber, status, mode, adminRole }: AdminProfile,
  publicURL?: string | undefined,
) => {
  try {
    const data = await prisma.$transaction([
      prisma.user.update({
        where: {
          id: userId,
        },
        data: {
          name,
          email,
          country,
          phoneNumber,
          photoURL: publicURL,
          status,
          admin: {
            update: {
              designation,
              mode: mode as Mode,
              adminRole,
            },
          },
        },
      }),
    ]);

    return data;
  } catch (error) {
    return error;
  }
};

export const getUser = async (id: string) => {
  // let user;

  // user = await prisma.admin.findUnique({
  //   where: {
  //     userId: id,
  //   },
  //   include: {
  //     user: true,
  //   },
  // });

  // if (!user) {
  //   user = await prisma.creator.findUnique({
  //     where: {
  //       userId: id,
  //     },
  //     include: {
  //       user: true,
  //     },
  //   });
  // }

  const user = await prisma.user.findUnique({
    where: {
      id,
    },
    include: {
      admin: true,
      creator: true,
    },
  });

  return user;
};

export const handleGetAdmins = async (userid: string) => {
  try {
    const admins = await prisma.user.findMany({
      where: {
        NOT: {
          id: userid,
        },
        role: 'admin',
      },
      include: {
        admin: true,
      },
    });

    return admins;
  } catch (error) {
    return error;
  }
};

interface AdminForm {
  name: string;
  email: string;
  phoneNumber: string;
  country: string;
  adminRole: string;
  designation: string;
}

export const createAdminForm = async (data: AdminForm) => {
  const { name, email, phoneNumber, country, adminRole  ,designation} = data;

  try {
    const user = await prisma.user.create({
      data: {
        name,
        email,
        phoneNumber,
        country,
        role: 'admin',
        status:'pending'
      },
    });
    const inviteToken = jwt.sign({ id: user?.id }, process.env.SESSION_SECRET as Secret, { expiresIn: '1h' });

    const admin = await prisma.admin.create({
      data: {
        userId: user.id,
        adminRole,
        designation,
        inviteToken,
      },
    });

    return { user, admin };
  } catch (error) {
    throw new Error(error as any);
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
          status: 'active',
          name,
          country,
          phoneNumber,
        },
      }),
      prisma.admin.update({
        where: {
          userId: userId,
        },
        data: {
          designation,
          inviteToken: null,
        },
      }),
    ]);
    return res;
  } catch (error) {
    throw new Error(error as string);
  }
};

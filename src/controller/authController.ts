/* eslint-disable no-unused-vars */
import jwt, { JwtPayload, Secret } from 'jsonwebtoken';
import { Employment, PrismaClient, RoleEnum } from '@prisma/client';
import { Request, Response } from 'express';
import { AdminInvitaion, AdminInvite, creatorVerificationEmail } from '../config/nodemailer.config';
import bcrypt from 'bcryptjs';
import { handleChangePassword } from 'src/service/authServices';
import { getUser } from 'src/service/userServices';
import { verifyToken } from '@utils/jwtHelper';
import { uploadImage, uploadProfileImage } from 'src/config/cloudStorage.config';

const prisma = new PrismaClient();

interface RequestData {
  email: string;
  password: string;
}

interface CreatorRequestData {
  name: string;
  email: string;
  password: string;
}

interface InterestData {
  name: string;
  rank: number;
}

interface IndustryData {
  name: string;
  rank: string;
}

// interface LanguagesData {
//   name: string;
// }

interface CreatorUpdateData {
  interests: InterestData[];
  Nationality: string;
  birthDate: Date;
  employment: string;
  industries: IndustryData[];
  instagram: string;
  languages: string[];
  location: string;
  phone: string;
  pronounce: string;
  tiktok: string;
}

export const registerUser = async (req: Request, res: Response) => {
  const { email, password }: RequestData = req.body;

  try {
    const search = await prisma.user.findFirst({
      where: {
        email,
      },
    });
    if (search) {
      return res.status(400).json({ message: 'User already exists' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);

    const data = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        role: 'admin',
      },
    });
    return res.status(201).json(data);
  } catch (error) {
    return res.status(400).json({ message: 'User already exists' });
  }
};

// Change password function
export const changePassword = async (req: Request, res: Response) => {
  const { oldPassword, newPassword, confirmNewPassword } = req.body;

  const { id } = req.user as any;
  try {
    const user = await prisma.user.findFirst({
      where: {
        id: id,
      },
    });

    if (!user) {
      return res.status(404).json({ message: 'Not found' });
    }

    const comparePass = await bcrypt.compare(oldPassword, user.password as string);

    if (!comparePass) {
      return res.status(400).json({ message: 'Wrong password' });
    }

    if (newPassword !== confirmNewPassword) {
      return res.status(400).json({ message: 'Make sure confirm password is same with with new password' });
    }

    const latestPassword = await bcrypt.hash(newPassword, 10);

    await handleChangePassword({ userId: id, latestPassword: latestPassword });
    return res.status(200).json({ message: 'Successfully changed password' });
  } catch (error) {
    return res.status(400).send('Error');
  }
};

// Temporary function for superadmin registration
export const registerSuperAdmin = async (req: Request, res: Response) => {
  const { email, password }: RequestData = req.body;
  try {
    const search = await prisma.user.findFirst({
      where: {
        email,
      },
    });

    console.log(search);

    if (search) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await prisma.$transaction(async (prisma) => {
      const newUser = await prisma.user.create({
        data: {
          email,
          password: hashedPassword,
          name: 'Afiq',
          role: 'superadmin',
          status: 'active',
        },
      });

      const newAdmin = await prisma.admin.create({
        data: {
          mode: 'god',
          userId: newUser.id,
        },
      });

      return { newUser, newAdmin };
    });

    return res.status(201).json(result);
  } catch (error) {
    return res.status(400).json({ message: 'User already exists' });
  }
};

// Function to register creator
export const registerCreator = async (req: Request, res: Response) => {
  const { name, email, password }: CreatorRequestData = req.body.email;
  try {
    const search = await prisma.user.findFirst({
      where: {
        email,
      },
    });

    if (search) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        role: 'creator',
        name: name,
      },
    });

    const data = await prisma.creator.create({
      data: {
        userId: user.id,
      },
      include: {
        user: true,
      },
    });

    const token = jwt.sign({ id: user.id }, process.env.ACCESSKEY as Secret, {
      expiresIn: '1h',
    });

    creatorVerificationEmail(user.email, token);

    return res.status(201).json({ user: data.user.email });
  } catch (error) {
    return res.status(400).send(error);
  }
};

export const registerFinanceUser = async (req: Request, res: Response) => {
  const { email, password, name } = req.body;

  try {
    // Check if the user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create the user with the finance role
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        role: 'finance' as RoleEnum, // Assign the finance role
        status: 'active',
      },
    });

    return res.status(201).json({ message: 'Finance user registered successfully', user });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// Function to display all users
export const displayAll = async (_req: Request, res: Response) => {
  try {
    const data = await prisma.user.findMany();

    return res.status(201).json({ data });
  } catch (error) {
    return res.status(400).json({ message: 'No user found.' });
  }
};

// Email invitation for admin
export const sendEmail = async (req: Request, res: Response) => {
  // add middleware to check the jwt token for authz
  const { email, userid } = req.body;

  try {
    const user = await prisma.user.findFirst({
      where: {
        id: userid,
      },
      include: {
        admin: true,
      },
    });
    if (user?.admin?.mode !== 'god') {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    const adminToken = jwt.sign({ id: user.id }, process.env.ACCESSKEY as Secret, {
      expiresIn: '1h',
    });
    AdminInvitaion(email, adminToken);
    return res.status(200).json({ message: 'Email sent' });
  } catch (error) {
    console.log(error);
  }
};

//Token verification
export const verifyAdmin = async (req: Request, res: Response) => {
  const { inviteToken } = req.query;

  try {
    // Find the user by the verification token
    const admin = await prisma.admin.findUnique({
      where: {
        inviteToken: inviteToken as string,
      },
    });

    const isVerify = jwt.verify(admin?.inviteToken as string, process.env.SESSION_SECRET as string);

    if (!isVerify) {
      return res.status(404).json({ message: 'Unauthorized' });
    }

    if (!admin) {
      return res.status(404).json({ message: 'Admin not found' });
    }

    const user = await prisma.user.findUnique({
      where: {
        id: admin.userId,
      },
      include: {
        admin: {
          include: {
            role: true,
          },
        },
      },
    });
    return res.status(200).json({ message: 'Admin verified successfully', user });
  } catch (error: any) {
    if (error.name) {
      return res.status(400).json({ error: 'Token expired. Please contact our admin.' });
    }
    return res.status(500).json({ error: 'An error occurred while verifying the user' });
  }
};

export const resendVerifyTokenAdmin = async (req: Request, res: Response) => {
  const { token } = req.body;
  try {
    const admin = await prisma.admin.findFirst({
      where: {
        inviteToken: token,
      },
    });

    if (!admin) {
      return res.status(404).json({ message: 'Invalid token' });
    }

    const newToken = jwt.sign({ id: admin?.userId }, process.env.SESSION_SECRET as Secret, { expiresIn: '1h' });

    const result = await prisma.admin.update({
      where: {
        id: admin.id,
      },
      data: {
        inviteToken: newToken,
      },
      include: {
        user: true,
      },
    });

    AdminInvite(result?.user.email as string, result?.inviteToken as string);

    return res.status(200).json({ message: 'New link has been sent to your email' });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const checkTokenValidity = async (req: Request, res: Response) => {
  const { token } = req.params;
  try {
    const isValid = await prisma.admin.findFirst({
      where: {
        inviteToken: token,
      },
    });

    if (!isValid) {
      return res.status(404).json({ message: 'Token is not valid' });
    }

    return res.status(200).json({ message: 'Token valid' });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const verifyCreator = async (req: Request, res: Response) => {
  const { token } = req.body;
  try {
    const result = await verifyToken(token);

    if (!result) {
      return res.status(400).json({ message: 'Unauthorized' });
    }

    const creator = await prisma.user.findFirst({
      where: {
        id: (result as JwtPayload).id,
      },
      include: {
        creator: true,
      },
    });

    if (!creator) {
      return res.status(404).json({ message: 'Not found.' });
    }

    await prisma.user.update({
      where: {
        id: creator.id,
      },
      data: {
        status: 'pending',
      },
    });

    const accessToken = jwt.sign({ id: creator.id }, process.env.ACCESSKEY as Secret, {
      expiresIn: '4h',
    });

    const refreshToken = jwt.sign({ id: creator.id }, process.env.REFRESHKEY as Secret);

    const session = req.session;
    session.userid = creator.id;
    session.refreshToken = refreshToken;

    res.cookie('userid', creator.id, {
      maxAge: 60 * 60 * 24 * 1000, // 1 Day
      httpOnly: true,
    });
    res.cookie('accessToken', accessToken, {
      maxAge: 60 * 60 * 4 * 1000, // 1 Day
      httpOnly: true,
    });

    return res.status(200).json({ message: 'Your are verified!', user: creator, accessToken });
  } catch (error) {
    return res.status(400).json({ message: 'Error verifying creator' });
  }
};

// Function for logout
export const logout = async (req: Request, res: Response) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(400).json({ message: 'Error logging out' });
    }
    res.clearCookie('userid');
    res.clearCookie('accessToken');
    return res.status(200).json({ message: 'Logged out' });
  });
};

// check creator full data with two tables user and creator
export const checkCreator = async (req: Request, res: Response) => {
  const { userid } = req.session;

  try {
    const creator = await prisma.creator.findFirst({
      where: {
        userId: userid,
      },
      include: {
        user: true,
      },
    });

    if (!creator) {
      return res.status(404).json({ message: 'Creator not found' });
    }

    return res.status(200).json({ creator });
  } catch (error) {
    return res.status(400).json({ message: 'Error fetching creator' });
  }
};

// Function to get current user
export const getCurrentUser = async (req: Request, res: Response) => {
  const { userid } = req.session;
  try {
    const user = await prisma.user.findFirst({
      where: {
        id: userid,
      },
      include: {
        admin: true,
        creator: true,
      },
    });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    return res.status(200).json({ user });
  } catch (error) {
    return res.status(400).json({ message: 'Error fetching user' });
  }
};

// Function to update creator information
export const updateCreator = async (req: Request, res: Response) => {
  const { userid } = req.session;

  const {
    phone,
    tiktok,
    pronounce,
    location,
    interests,
    languages,
    instagram,
    // industries,
    employment,
    birthDate,
    Nationality,
  }: CreatorUpdateData = req.body;

  const data = new Date(birthDate);

  try {
    const creator = await prisma.creator.update({
      where: {
        userId: userid,
      },
      data: {
        user: {
          update: {
            phoneNumber: phone,
            country: Nationality,
            status: 'active',
          },
        },
        instagram,
        pronounce,
        location,
        birthDate: data,
        employment: employment as Employment,
        tiktok,
        languages: languages,
        interests: {
          create: interests.map((interest) => ({ name: interest.name, rank: interest.rank })),
        },
        // industries: {
        //   create: industries.map((industry) => ({ name: industry.name, rank: industry.rank })),
        // },
      },
      include: {
        interests: true,
        // industries: true,
      },
    });

    return res.status(200).json({ creator });
  } catch (error) {
    return res.status(400).json({ message: 'Error updating creator' });
  }
};

// Function to get user's information
export const getprofile = async (req: Request, res: Response) => {
  const refreshToken = req.session.refreshToken as string;

  if (!refreshToken) {
    req.session.destroy((err) => {
      if (err) {
        return res.status(400).json({ message: 'Error logging out' });
      }
      res.clearCookie('userid');
      res.clearCookie('accessToken');
      return res.status(401).json('You are not authenticated');
    });
    return;
  }

  jwt.verify(refreshToken, process.env.REFRESHKEY as string, async (err: any, decode: any) => {
    if (err) return res.status(403).json({ message: 'Forbidden' });

    try {
      const user = await getUser(decode.id);

      if (!user) return res.status(401).json({ message: 'Unauthorized' });

      const accessToken = jwt.sign({ id: user.id }, process.env.ACCESSKEY as Secret, {
        expiresIn: '4h',
      });

      if (user?.role === 'creator' && user?.status === 'pending') {
        return res.status(202).json({ message: 'Accoung pending.', user, accessToken });
      }

      switch (user?.status) {
        case 'banned':
          return res.status(400).json({ message: 'Account banned.' });
        case 'pending':
          return res.status(202).json({ message: 'Accoung pending.' });
        case 'rejected':
          return res.status(403).json({ message: 'Account rejected.' });
      }

      res.cookie('accessToken', accessToken, {
        maxAge: 60 * 60 * 4 * 1000, // 1 Day
        httpOnly: true,
      });

      return res.status(200).json({ user, accessToken });
    } catch (error) {
      return res.status(500).json({ message: 'Internal Server Error' });
    }
  });
};

// Login for both creator and admin
export const login = async (req: Request, res: Response) => {
  const { email, password }: RequestData = req.body;

  try {
    const data = await prisma.user.findFirst({
      where: {
        email,
      },
      include: {
        paymentForm: true,
        admin: {
          include: {
            adminPermissionModule: {
              include: {
                module: true,
                permission: true,
              },
            },
            role: {
              include: {
                permissions: true,
              },
            },
          },
        },
        creator: {
          include: {
            industries: true,
            interests: true,
          },
        },
        pitch: true,
        shortlisted: true,
      },
    });

    if (!data) return res.status(404).json({ message: 'Wrong email' });

    switch (data.status) {
      case 'banned':
        return res.status(400).json({ message: 'Account banned.' });
      case 'pending':
        return res.status(202).json({ message: 'Accoung pending.' });
      case 'rejected':
        return res.status(403).json({ message: 'Account rejected.' });
    }

    // // Hashed password
    const isMatch = await bcrypt.compare(password, data.password as string);

    if (!isMatch) {
      return res.status(404).json({ message: 'Wrong password' });
    }

    // 4 hours
    const accessToken = jwt.sign({ id: data.id }, process.env.ACCESSKEY as Secret, {
      expiresIn: '4h',
    });

    const refreshToken = jwt.sign({ id: data.id }, process.env.REFRESHKEY as Secret);

    const session = req.session;
    session.userid = data.id;
    session.refreshToken = refreshToken;
    session.role = data.role;
    session.name = data.name || '';
    session.photoURL = data.photoURL || '';

    res.cookie('userid', data.id, {
      maxAge: 60 * 60 * 24 * 1000, // 1 Day
      httpOnly: true,
    });

    res.cookie('accessToken', accessToken, {
      maxAge: 60 * 60 * 4 * 1000, // 1 Day
      httpOnly: true,
    });

    return res.status(200).json({
      user: data,
      accessToken: accessToken,
    });
  } catch (error) {
    console.log(error);
    return res.send(error);
  }
};

export const updateProfileCreator = async (req: Request, res: Response) => {
  const { name, email, phoneNumber, country, about, id, state, address } = JSON.parse(req.body.data);

  try {
    const creator = await prisma.creator.findFirst({
      where: {
        userId: id,
      },
    });

    if (req.files) {
      const { image } = req?.files as any;

      const url = await uploadProfileImage(image.tempFilePath, image.name, 'creator');
      await prisma.creator.update({
        where: {
          userId: id,
        },
        data: {
          state: state,
          address: address,
          mediaKit: {
            upsert: {
              where: {
                creatorId: creator?.id,
              },
              update: {
                about: about,
              },
              create: {
                about: about,
              },
            },
          },
          user: {
            update: {
              name: name,
              email: email,
              photoURL: url,
              phoneNumber: phoneNumber,
              country: country,
            },
          },
        },
      });
    } else {
      await prisma.creator.update({
        where: {
          userId: id,
        },
        data: {
          state: state,
          address: address,
          mediaKit: {
            upsert: {
              where: {
                creatorId: creator?.id,
              },
              update: {
                about: about,
              },
              create: {
                about: about,
              },
            },
          },
          user: {
            update: {
              name: name,
              email: email,
              phoneNumber: phoneNumber,
              country: country,
            },
          },
        },
      });
    }
    return res.status(200).json({ message: 'Succesfully updated' });
  } catch (error) {
    console.log(error);
    return res.status(400).json({ message: 'Error updating creator' });
  }
};

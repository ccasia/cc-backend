/* eslint-disable no-unused-vars */
import jwt, { JwtPayload, Secret } from 'jsonwebtoken';
import { Employment, PrismaClient } from '@prisma/client';
import { Request, Response } from 'express';
import { AdminInvitaion, creatorVerificationEmail } from '../config/nodemailer.config';
// import session from 'express-session';
import bcrypt from 'bcryptjs';
import { getUser } from 'src/service/userServices';
import { handleChangePassword } from 'src/service/authServices';
import { verifyToken } from '@utils/jwtHelper';

const prisma = new PrismaClient();

interface RequestData {
  email: string;
  password: string;
  type: any;
}

interface CreatorRequestData {
  firstName: string;
  lastName: string;
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

interface LanguagesData {
  name: string;
}

interface CreatorUpdateData {
  Interests: InterestData[];
  Nationality: string;
  birthDate: Date;
  employment: string;
  industries: IndustryData[];
  instagram: string;
  lanaugages: LanguagesData[];
  location: string;
  phone: string;
  pronounce: string;
  tiktok: string;
}

export const login = async (req: Request, res: Response) => {
  const { email, password, type }: RequestData = req.body;
  let data;
  try {
    if (type.admin) {
      data = await prisma.admin.findFirst({
        where: {
          user: {
            email: email,
          },
        },
        include: {
          user: true,
        },
      });
    } else {
      data = await prisma.creator.findFirst({
        where: {
          user: {
            email: email,
          },
        },
        include: {
          user: true,
        },
      });
    }

    if (!data) return res.status(404).json({ message: 'Wrong email' });

    const isActive = await prisma.user.findFirst({
      where: {
        AND: [
          {
            email: data.user.email,
          },
          {
            OR: [
              {
                admin: {
                  status: 'active',
                },
              },
              {
                creator: {
                  status: 'active',
                },
              },
            ],
          },
        ],
      },
    });

    if (!isActive) return res.status(400).json({ message: 'Account is not active' });

    // // Hashed password
    const isMatch = await bcrypt.compare(password, data.user.password as string);

    if (!isMatch) {
      return res.status(404).json({ message: 'Wrong password' });
    }

    const accessToken = jwt.sign({ id: data.user.id }, process.env.ACCESSKEY as Secret, {
      expiresIn: '1h',
    });

    const session = req.session;
    session.userid = data.user.id;
    session.accessToken = accessToken;

    res.cookie('userid', data.user.id, {
      maxAge: 60 * 60 * 24 * 1000, // 1 Day
      httpOnly: true,
    });
    res.cookie('accessToken', accessToken, {
      maxAge: 60 * 60 * 24 * 1000, // 1 Day
      httpOnly: true,
    });

    return res.status(200).json({
      user: data,
      accessToken: accessToken,
    });
  } catch (error) {
    return res.send(error);
  }
};

// normal user for testing
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
    if (search) {
      return res.status(400).json({ message: 'User already exists' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);

    const data = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        role: 'superadmin',
      },
    });
    const admin = await prisma.admin.create({
      data: {
        name: 'admin',
        designation: 'admin',
        country: 'India',
        photoURL: 'https://www.google.com',
        phoneNumber: '1234567890',
        status: 'active',
        userId: data.id,
      },
    });

    return res.status(201).json({ data, admin });
  } catch (error) {
    return res.status(400).json({ message: 'User already exists' });
  }
};

// Function to register creator
export const registerCreator = async (req: Request, res: Response) => {
  const { firstName, lastName, email, password }: CreatorRequestData = req.body.email;
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
      },
    });

    const data = await prisma.creator.create({
      data: {
        firstName,
        lastName,
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

// Function to display all users
export const displayAll = async (_req: Request, res: Response) => {
  try {
    const data = await prisma.user.findMany();
    console.log(data);
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
    });
    if (user?.role !== 'superadmin') {
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

    const isVerify = await jwt.verify(admin?.inviteToken as string, process.env.SESSION_SECRET as string);

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
    });

    return res.status(200).json({ message: 'Admin verified successfully', user });
  } catch (error) {
    return res.status(500).json({ error: 'An error occurred while verifying the user' });
  }
};

export const verifyCreator = async (req: Request, res: Response) => {
  const { token } = req.body;
  try {
    const result = await verifyToken(token);

    if (!result) {
      return res.status(400).json({ message: 'Unauthorized' });
    }

    const creator = await prisma.creator.findFirst({
      where: {
        userId: (result as JwtPayload).id,
      },
      include: {
        user: true,
      },
    });

    if (!creator) {
      return res.status(404).json({ message: 'Not found.' });
    }

    await prisma.creator.update({
      where: {
        userId: creator.userId,
      },
      data: {
        status: 'active',
      },
    });

    const accessToken = jwt.sign({ id: creator.user.id }, process.env.ACCESSKEY as Secret, {
      expiresIn: '1h',
    });

    const session = req.session;
    session.userid = creator.user.id;
    session.accessToken = accessToken;

    res.cookie('userid', creator.user.id, {
      maxAge: 60 * 60 * 24 * 1000, // 1 Day
      httpOnly: true,
    });
    res.cookie('accessToken', accessToken, {
      maxAge: 60 * 60 * 24 * 1000, // 1 Day
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
    Interests,
    industries,
    instagram,
    phone,
    tiktok,
    Nationality,
    birthDate,
    employment,
    lanaugages,
    location,
    pronounce,
  }: CreatorUpdateData = req.body;

  const data = new Date(birthDate);
  try {
    const creator = await prisma.creator.update({
      where: {
        userId: userid,
      },
      data: {
        instagram,
        phone,
        pronounce,
        Nationality,
        location,
        birthDate: data,
        employment: employment as Employment,
        tiktok,
        languages: {
          create: lanaugages.map((language) => ({ name: language })),
        },
        interests: {
          create: Interests.map((interest) => ({ name: interest.name, rank: interest.rank })),
        },
        industries: {
          create: industries.map((industry) => ({ name: industry.name, rank: industry.rank })),
        },
      },
      include: {
        interests: true,
        industries: true,
        languages: true,
      },
    });

    return res.status(200).json({ creator });
  } catch (error) {
    console.log(error);
    return res.status(400).json({ message: 'Error updating creator' });
  }
};

// Function to get user's information
export const getprofile = async (req: Request, res: Response) => {
  try {
    const userid = req.session.userid as any;

    const user = await getUser(userid);
    console.log(user);
    return res.status(200).json({ user });
  } catch (error) {
    return res.status(404).json({
      error: (error as any).message,
    });
  }
};

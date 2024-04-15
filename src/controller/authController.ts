/* eslint-disable no-unused-vars */
import jwt, { Secret } from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { Request, Response } from 'express';
import { AdminInvitaion } from '../config/nodemailer.config';
// import session from 'express-session';
import bcrypt from 'bcryptjs';
import { getUser } from 'src/service/userServices';

const prisma = new PrismaClient();

interface RequestData {
  email: string;
  password: string;
}

export const login = async (req: Request, res: Response) => {
  const { email, password }: RequestData = req.body;

  try {
    const data = await prisma.user.findFirst({
      where: {
        email,
      },
    });

    if (!data) return res.status(404).json({ message: 'Wrong email' });

    // Hashed password
    const isMatch = await bcrypt.compare(password, data.password);
    if (!isMatch) {
      return res.status(404).json({ message: 'Wrong password' });
    }

    const accessToken = jwt.sign({ id: data.id }, process.env.ACCESSKEY as Secret, {
      expiresIn: '1h',
    });
    // const refreshToken = jwt.sign({ id: data.id }, process.env.REFRESHKEY as Secret, {});

    const session = req.session;
    session.userid = data.id;
    session.accessToken = accessToken;
    res.cookie('userid', data.id, {
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

// temporary function for superadmin
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

interface AdminRequestData {
  firstname: string;
  lastname: string;
  phone: string;
  email: string;
  password: string;
}
// for saprate admin function
export const registerAdmin = async (req: Request, res: Response) => {
  const { firstname, lastname, email, password }: AdminRequestData = req.body;

  const verifyToken = jwt.sign({ email }, process.env.ACCESSKEY as string, { expiresIn: '1h' });

  try {
    const user = await prisma.user.findFirst({
      where: {
        id: req.session.userid,
      },
    });
    if (user?.role !== 'superadmin') {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const data = await prisma.user.create({
      data: {
        email,
        password,
        role: 'admin',
      },
    });
    const name = firstname + ' ' + lastname;
    const admin = await prisma.admin.create({
      data: {
        name: name,
        designation: 'admin',
        country: 'India',
        photoURL: 'https://www.google.com',
        phoneNumber: '019223223',
        confirmationToken: verifyToken,
        status: 'inactive',
        userId: data.id,
      },
    });
    // add email
    // AdminInvitaion(email, verifyToken);
    AdminInvitaion(email, verifyToken);
    return res.status(201).json({ data, admin });
  } catch (error) {
    return res.status(400).json({ message: 'User already exists' });
  }
};

interface CreatorRequestData {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}

// register creator only
export const registerCreator = async (req: Request, res: Response) => {
  console.log(req.body);

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

    const data = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        role: 'creator',
      },
    });

    const creator = await prisma.creator.create({
      data: {
        firstName,
        lastName,
        userId: data.id,
      },
    });

    return res.status(201).json({ user: data, creator: creator });
  } catch (error) {
    console.log(error);
  }
};

export const displayAll = async (_req: Request, res: Response) => {
  try {
    const data = await prisma.user.findMany();
    console.log(data);
    return res.status(201).json({ data });
  } catch (error) {
    return res.status(400).json({ message: 'No user found.' });
  }
};

// email invitaion
export const sendEmail = async (req: Request, res: Response) => {
  // add middleware to check the jwt token for authz
  const { email, userid } = req.body;
  console.log(req);
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
export const verifyUser = async (req: Request, res: Response) => {
  const { token } = req.body;
  try {
    // Find the user by the verification token
    const user = await prisma.admin.findUnique({
      where: {
        confirmationToken: token,
      },
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    // Update the user's verified status
    const updatedUser = await prisma.admin.update({
      where: {
        userId: user.userId,
      },
      data: {
        status: 'active',
      },
    });

    return res.status(200).json({ message: 'User verified successfully', user: updatedUser });
  } catch (error) {
    console.error('Error verifying user:', error);
    return res.status(500).json({ error: 'An error occurred while verifying the user' });
  }
};

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

export const getprofile = async (req: Request, res: Response) => {
  try {
    const { userId } = req.user as any;
    const user = await getUser(userId);
    return res.status(200).json({ user });
  } catch (error) {
    return res.status(404).json({
      error: (error as any).message,
    });
  }
};

/* eslint-disable no-unused-vars */
import jwt, { Secret } from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { Request, Response } from 'express';
import { AdminInvitaion } from '../config/nodemailer.config';
// import session from 'express-session';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

type RequestData = {
  email: string;
  password: string;
};

export const login = async (req: Request, res: Response) => {
  const { email, password }: RequestData = req.body;

  try {
    const data = await prisma.user.findFirst({
      where: {
        email,
      },
    });

    if (!data) return res.status(404).json({ message: 'User not found' });

    // hashed password
    const isMatch = await bcrypt.compare(password, data.password);
    if (!isMatch) {
      return res.status(404).json({ message: 'Invalid credentials' });
    }

    // if (data?.password !== password) {
    //   return res.status(401).json({ message: 'Invalid credentials' });
    // }
    const accessToken = jwt.sign({ id: data.id }, process.env.ACCESSKEY as Secret, {
      expiresIn: '1h',
    });
    // const refreshToken = jwt.sign({ id: data.id }, process.env.REFRESHKEY as Secret, {});

    var session = req.session;
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
  console.log('register', req.body);
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
    let hashedPassword = await bcrypt.hash(password, 10);
    const data = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        role: 'normal',
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
    let hashedPassword = await bcrypt.hash(password, 10);

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
        userId: data.id,
      },
    });

    return res.status(201).json({ data, admin });
  } catch (error) {
    return res.status(400).json({ message: 'User already exists' });
  }
};

type AdminRequestData = {
  firstname: string;
  lastname: string;
  phone: string;
  email: string;
  password: string;
};
// for saprate admin function
export const registerAdmin = async (req: Request, res: Response) => {
  console.log('register', req.body);
  const { firstname, lastname, phone, email, password }: AdminRequestData = req.body;
  try {
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
        phoneNumber: phone,
        userId: data.id,
      },
    });

    return res.status(201).json({ data, admin });
  } catch (error) {
    return res.status(400).json({ message: 'User already exists' });
  }
};

type CreatorRequestData = {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
};

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
    let hashedPassword = await bcrypt.hash(password, 10);

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

export const displayAll = async (req: Request, res: Response) => {
  console.log(req.body);
  try {
    const data = await prisma.user.findMany();
    console.log(data);
    return res.status(201).json({ data });
  } catch (error) {
    return res.status(400).json({ message: 'User already exists' });
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

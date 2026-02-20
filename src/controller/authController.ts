/* eslint-disable no-unused-vars */
import jwt, { JwtPayload, Secret } from 'jsonwebtoken';
import { Employment, PrismaClient, RoleEnum, Prisma } from '@prisma/client';
import { Request, Response } from 'express';
import {
  AdminInvitaion,
  AdminInvite,
  ClientInvitation,
  creatorVerificationEmail,
  clientVerificationEmail,
} from '@configs/nodemailer.config';
import { handleChangePassword } from '@services/authServices';
import { getUser } from '@services/userServices';

import { getJWTToken, verifyToken } from '@utils/jwtHelper';
import { uploadProfileImage } from '@configs/cloudStorage.config';

import { createKanbanBoard } from './kanbanController';
import { saveCreatorToSpreadsheet } from '@helper/registeredCreatorSpreadsheet';
import { addReferralData } from '@services/google_sheets/sheets';
import axios from 'axios';
import bcrypt from 'bcryptjs';

import { generateRandomString } from '@utils/randomString';
import dayjs from 'dayjs';
import { TokenSet, XeroClient } from 'xero-node';
import { generateSecret, generateURI } from 'otplib';

import QRCode from 'qrcode';

const prisma = new PrismaClient();

interface RequestData {
  email: string;
  password: string;
}

interface CreatorRequestData {
  name: string;
  email: string;
  password: string;
  // confirmPassword: string;
  recaptcha: string;
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
  socialMediaData: Prisma.InputJsonValue;
  city: string;
  referralCode?: string;
  instagramProfileLink?: string;
  tiktokProfileLink?: string;
}

const client_id: string = process.env.XERO_CLIENT_ID as string;
const client_secret: string = process.env.XERO_CLIENT_SECRET as string;
const redirectUrl: string = process.env.XERO_REDIRECT_URL as string;
const scopes: string = process.env.XERO_SCOPES as string;

const xero = new XeroClient({
  clientId: client_id,
  clientSecret: client_secret,
  redirectUris: [redirectUrl],
  scopes: scopes?.split(' '),
});

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
    return res.status(200).json({ message: 'Password updated successfully!' });
  } catch (error) {
    return res.status(400).send('Error');
  }
};

// Temporary function for superadmin registration
export const registerSuperAdmin = async (req: Request, res: Response) => {
  const { email, password }: RequestData = req.body;
  try {
    const superadmin = await prisma.user.findFirst({
      where: {
        email,
      },
    });

    if (superadmin) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email,
          password: hashedPassword,
          name: 'Afiq',
          role: 'superadmin',
          status: 'active',
        },
      });

      const newAdmin = await tx.admin.create({
        data: {
          mode: 'god',
          userId: newUser.id,
        },
      });

      return { newUser, newAdmin };
    });

    await createKanbanBoard(result.newUser.id);

    return res.status(201).json(result);
  } catch (error) {
    return res.status(400).json({ message: 'User already exists' });
  }
};

// Function to register creator
export const registerCreator = async (req: Request, res: Response) => {
  const { name, email, password, recaptcha, creatorData } = req.body;

  console.log('Backend received registration data:', { name, email, password: '***', recaptcha: '***', creatorData });

  if (!recaptcha) {
    return res.status(400).json({ success: false, message: 'Token is missing.' });
  }

  try {
    // Verify recaptcha
    const secretKey = process.env.RECAPTCHA_SECRETKEY;
    const response = await axios.post(`https://www.google.com/recaptcha/api/siteverify`, null, {
      params: {
        secret: secretKey,
        response: recaptcha,
      },
    });

    if (response.data.success) {
      const search = await prisma.user.findFirst({
        where: {
          email: email.toLowerCase(),
        },
      });

      if (search) {
        return res.status(400).json({ message: 'Email already exists' });
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      // Create user and creator in a transaction
      const result = await prisma.$transaction(async (tx) => {
        // Create user
        const user = await tx.user.create({
          data: {
            email: email.toLowerCase(),
            password: hashedPassword,
            role: 'creator',
            name: name,
            phoneNumber: creatorData?.phone || '',
            country: creatorData?.Nationality || '',
            city: creatorData?.city || '',
            referralCode: creatorData?.referralCode || null,
          },
        });

        // Create creator with profile data
        const creatorObj: any = {
          userId: user.id,
        };

        if (creatorData) {
          Object.assign(creatorObj, {
            instagram: creatorData.instagram || '',
            pronounce: creatorData.pronounce || '',
            location: creatorData.location || '',
            birthDate: creatorData.birthDate ? new Date(creatorData.birthDate) : null,
            employment: creatorData.employment || '',
            tiktok: creatorData.tiktok || '',
            languages: creatorData.languages || [],
            instagramProfileLink: creatorData.instagramProfileLink || '',
            tiktokProfileLink: creatorData.tiktokProfileLink || '',
          });
        }

        const creator = await tx.creator.create({
          data: {
            ...creatorObj,
            isOnBoardingFormCompleted: true,
          },
          include: {
            user: true,
            instagramUser: {
              select: {
                username: true,
              },
            },
            tiktokUser: {
              select: {
                display_name: true,
              },
            },
          },
        });

        // Create interests if provided
        if (creatorData?.interests && creatorData.interests.length > 0) {
          // Handle both formats: array of strings or array of objects
          const interestsToCreate = creatorData.interests.map((interest: any) => {
            const interestName = typeof interest === 'string' ? interest : interest.name;
            return {
              name: interestName,
              userId: user.id,
            };
          });

          if (interestsToCreate.length > 0) {
            await tx.interest.createMany({
              data: interestsToCreate,
            });
          }
        }

        return { user, creator };
      });

      // Create kanban board for the new creator
      await createKanbanBoard(result.user.id, 'creator');

      // Send verification email
      const token = jwt.sign({ id: result.user.id }, process.env.ACCESSKEY as Secret, { expiresIn: '15m' });

      let shortCode;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        shortCode = generateRandomString();

        const isShortCodeExist = await prisma.emailVerification.findFirst({
          where: { shortCode },
        });

        if (!isShortCodeExist) break;
      }

      const code = await prisma.emailVerification.create({
        data: {
          shortCode: shortCode!,
          user: {
            connect: {
              id: result.user.id,
            },
          },
          expiredAt: dayjs().add(15, 'minute').toDate(),
          token: token,
        },
      });

      creatorVerificationEmail(result.user.email, code.shortCode);

      // Save creator information to Google Spreadsheet
      saveCreatorToSpreadsheet({
        name: result.user.name || '',
        email: result.user.email,
        phoneNumber: result.user.phoneNumber || '',
        country: result.user.country || '',
        createdAt: result.user.createdAt,
      }).catch((error) => {
        console.error('Error saving creator to spreadsheet:', error);
      });

      // Add referral data to Google Sheets if referral code exists
      if (creatorData?.referralCode && creatorData.referralCode.trim() !== '') {
        console.log('Adding referral data to Google Sheets:', {
          name: result.user.name || '',
          email: result.user.email,
          phoneNumber: result.user.phoneNumber || '',
          referralCode: creatorData.referralCode,
        });

        // Try to add referral data to the same spreadsheet that's already working
        const existingSpreadsheetId = process.env.REGISTERED_CREATORS_SPREADSHEET_ID;
        if (existingSpreadsheetId) {
          console.log('Using existing working spreadsheet ID:', existingSpreadsheetId);
          addReferralData({
            spreadSheetId: existingSpreadsheetId,
            sheetByTitle: 'Referral Code', // Will rename Sheet1 to this name
            data: {
              name: result.user.name || '',
              email: result.user.email,
              phoneNumber: result.user.phoneNumber || '',
              referralCode: creatorData.referralCode,
            },
          })
            .then(() => {
              console.log('Successfully added referral data to Google Sheets');
              return;
            })
            .catch((error) => {
              console.error('Error adding referral data to Google Sheets:', error);
            });
        } else {
          console.log('No existing spreadsheet ID found, trying with provided ID...');
          addReferralData({
            spreadSheetId: '1ZiygBUJOa-OQPc8ybZ1tKDoJouTeynNVsYc2YfwH9ko', // Your Google Sheets ID
            sheetByTitle: 'Referral Code', // Try with default sheet name first
            data: {
              name: result.user.name || '',
              email: result.user.email,
              phoneNumber: result.user.phoneNumber || '',
              referralCode: creatorData.referralCode,
            },
          })
            .then(() => {
              console.log('Successfully added referral data to Google Sheets');
              return;
            })
            .catch((error) => {
              console.error('Error adding referral data to Google Sheets:', error);
            });
        }
      } else {
        console.log('No referral code provided or referral code is empty');
      }

      return res.status(201).json({ user: result.user.email });
    }

    return res.status(400).json({ success: false, message: 'Verification failed.' });
  } catch (error) {
    console.error('Creator registration error:', error);
    return res.status(400).json({ message: 'Error registering creator', error: error.message });
  }
};

export const registerClient = async (req: Request, res: Response) => {
  const { name, email, password } = req.body;

  console.log('Backend received client registration data:', { name, email, password: '***' });

  try {
    const search = await prisma.user.findFirst({
      where: {
        email: email.toLowerCase(),
      },
    });

    if (search) {
      return res.status(400).json({ message: 'Email already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user and client in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create user with pending status
      const user = await tx.user.create({
        data: {
          email: email.toLowerCase(),
          password: hashedPassword,
          role: 'client',
          name: name,
          status: 'pending',
          isActive: false,
        },
      });

      // Get or create default client role
      let defaultClientRole = await tx.role.findFirst({
        where: { name: 'Client' },
      });

      if (!defaultClientRole) {
        defaultClientRole = await tx.role.create({
          data: {
            name: 'Client',
          },
        });
      }

      // Create admin record for client with Client role
      const admin = await tx.admin.create({
        data: {
          userId: user.id,
          roleId: defaultClientRole.id,
          mode: 'normal', // Default mode for client admins
        },
      });

      // Create client record
      const client = await tx.client.create({
        data: {
          userId: user.id,
        },
      });

      return { user, client, admin };
    });

    // Send verification email
    const token = jwt.sign({ id: result.user.id }, process.env.ACCESSKEY as Secret, { expiresIn: '15m' });

    let shortCode;

    // Generate unique short code
    // eslint-disable-next-line no-constant-condition
    while (true) {
      shortCode = generateRandomString();

      const isShortCodeExist = await prisma.emailVerification.findFirst({
        where: { shortCode },
      });

      if (!isShortCodeExist) break;
    }

    const code = await prisma.emailVerification.create({
      data: {
        shortCode: shortCode!,
        user: {
          connect: {
            id: result.user.id,
          },
        },
        expiredAt: dayjs().add(15, 'minute').toDate(),
        token: token,
      },
    });

    clientVerificationEmail(result.user.email, code.shortCode);

    return res.status(201).json({
      message: 'Client registered successfully. Please check your email to verify your account.',
      email: result.user.email,
    });
  } catch (error) {
    console.error('Client registration error:', error);
    return res.status(400).json({ message: 'Error registering client', error: error.message });
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
    return res.status(400).json(error);
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

    if (!admin) {
      return res.status(404).json({ message: 'Admin not found' });
    }

    const isVerify = jwt.verify(admin?.inviteToken as string, process.env.SESSION_SECRET as string);

    if (!isVerify) {
      return res.status(404).json({ message: 'Unauthorized' });
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
      return res.status(400).json({ message: 'Token expired. Please contact our admin.' });
    }
    return res.status(500).json({ message: 'An error occurred while verifying the user' });
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
      return res.status(404).json({ message: 'Invalid token.' });
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

  if (!token) return res.status(404).json({ message: 'Token is missing' });

  try {
    const { jwtToken } = await getJWTToken(token as string);

    if (!jwtToken) return res.status(400).json({ message: 'Access token not found' });

    const result = verifyToken(jwtToken);

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

    // Update user status to active
    const user = await prisma.user.update({
      where: {
        id: creator.id,
      },
      data: {
        status: 'active',
      },
    });

    if (user.emailVerificationId) {
      await prisma.emailVerification.delete({
        where: {
          id: user.emailVerificationId,
        },
      });
    }

    // Create kanban board if it doesn't exist yet
    const board = await prisma.board.findFirst({
      where: {
        userId: creator.id,
      },
    });

    if (!board) {
      await createKanbanBoard(creator.id, 'creator');
    }

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

    return res.status(200).json({ message: 'Your are verified!', user: creator });
  } catch (error) {
    console.log(error);
    if (error instanceof Error) {
      return res.status(400).json(error.message);
    }
    if (error.message) return res.status(400).json({ message: error.message, tokenExpired: true });
    return res.status(400).json({ message: 'Error verifying creator' });
  }
};

export const verifyClient = async (req: Request, res: Response) => {
  const { token } = req.body;

  if (!token) return res.status(404).json({ message: 'Token is missing' });

  try {
    const { jwtToken } = await getJWTToken(token as string);

    if (!jwtToken) return res.status(400).json({ message: 'Access token not found' });

    const result = verifyToken(jwtToken);

    if (!result) {
      return res.status(400).json({ message: 'Unauthorized' });
    }

    const client = await prisma.user.findFirst({
      where: {
        id: (result as JwtPayload).id,
      },
      include: {
        client: true,
      },
    });

    if (!client) {
      return res.status(404).json({ message: 'Not found.' });
    }

    // Update user status to active
    const user = await prisma.user.update({
      where: {
        id: client.id,
      },
      data: {
        status: 'active',
        isActive: true,
      },
    });

    if (user.emailVerificationId) {
      await prisma.emailVerification.delete({
        where: {
          id: user.emailVerificationId,
        },
      });
    }

    const accessToken = jwt.sign({ id: client.id }, process.env.ACCESSKEY as Secret, {
      expiresIn: '4h',
    });

    const refreshToken = jwt.sign({ id: client.id }, process.env.REFRESHKEY as Secret);

    const session = req.session;
    session.userid = client.id;
    session.refreshToken = refreshToken;

    res.cookie('userid', client.id, {
      maxAge: 60 * 60 * 24 * 1000, // 1 Day
      httpOnly: true,
    });

    res.cookie('accessToken', accessToken, {
      maxAge: 60 * 60 * 4 * 1000, // 4 Hours
      httpOnly: true,
    });

    return res.status(200).json({
      message: 'Your email has been verified successfully!',
      user: client,
      accessToken,
    });
  } catch (error) {
    console.log(error);
    if (error instanceof Error) {
      return res.status(400).json(error.message);
    }
    if (error.message) return res.status(400).json({ message: error.message, tokenExpired: true });
    return res.status(400).json({ message: 'Error verifying client' });
  }
};

// Function for logout
export const logout = async (req: Request, res: Response) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(400).json({ message: 'Error logging out' });
    }
    res.clearCookie('connect.sid');
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

    // if (creator.user.status === 'pending') {
    //   await prisma.user.update({
    //     where: { id: creator.user.id },
    //     data: {
    //       creator: {
    //         update: {
    //           isInfoCompleted: false,
    //         },
    //       },
    //     },
    //   });
    // }

    await prisma.user.update({
      where: {
        id: creator.userId,
      },
      data: {
        status: 'active',
      },
    });

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

    const isChildAccount = await prisma.childAccount.findFirst({
      where: { email: user.email },
    });

    return res.status(200).json({
      user: {
        ...user,
        isChildAccount: !!isChildAccount,
      },
    });
  } catch (error) {
    return res.status(400).json({ message: 'Error fetching user' });
  }
};

// Function to update creator information
export const updateCreator = async (req: Request, res: Response) => {
  const { userid } = req.session;

  if (!userid) {
    return res.status(401).json({ message: 'User not authenticated' });
  }

  const {
    phone,
    tiktok,
    pronounce,
    location,
    interests,
    languages,
    instagram,
    employment,
    birthDate,
    Nationality,
    socialMediaData,
    city,
    referralCode,
    instagramProfileLink,
    tiktokProfileLink,
  }: CreatorUpdateData = req.body;

  try {
    let parsedBirthDate: Date | undefined;

    if (birthDate) {
      parsedBirthDate = new Date(birthDate);
      if (isNaN(parsedBirthDate.getTime())) {
        throw new Error('Invalid birth date');
      }
    }

    // Parse socialMediaData if it's a string
    let parsedSocialMediaData = socialMediaData;

    if (typeof socialMediaData === 'string') {
      try {
        parsedSocialMediaData = JSON.parse(socialMediaData);
      } catch (error) {
        console.error('Error parsing socialMediaData:', error);
        throw new Error('Invalid socialMediaData format');
      }
    }

    const user = await prisma.user.findUnique({
      where: {
        id: userid,
      },
      include: {
        creator: true,
        Board: true,
      },
    });

    if (!user) {
      return res.status(404).json({ message: 'Creator Not Found' });
    }

    const creator = await prisma.creator.update({
      where: {
        userId: user.id,
      },
      data: {
        user: {
          update: {
            phoneNumber: phone,
            country: Nationality,
            status: 'active',
            city: city,
            referralCode: referralCode,
          },
        },
        instagram,
        pronounce,
        location,
        birthDate: parsedBirthDate,
        employment: employment as Employment,
        tiktok,
        languages: languages,
        instagramProfileLink,
        tiktokProfileLink,
        ...(Array.isArray(interests) && interests.length > 0
          ? {
              interests: {
                create: interests.map((interest) => ({ name: interest })),
              },
            }
          : {}),
        socialMediaData: parsedSocialMediaData, // Store as JSON object
        isOnBoardingFormCompleted: true,
      },
      include: {
        interests: true,
        user: true,
      },
    });

    if (!user.Board) {
      await createKanbanBoard(creator.user.id, 'creator');
    }

    // Add referral data to Google Sheets if referral code exists and user doesn't already have one
    if (referralCode && referralCode.trim() !== '' && !user.referralCode) {
      const existingSpreadsheetId = process.env.REGISTERED_CREATORS_SPREADSHEET_ID;
      if (existingSpreadsheetId) {
        addReferralData({
          spreadSheetId: existingSpreadsheetId,
          sheetByTitle: 'Referral Code', // Will rename Sheet1 to this name
          data: {
            name: creator.user.name || '',
            email: creator.user.email,
            phoneNumber: creator.user.phoneNumber || '',
            referralCode: referralCode,
          },
        }).catch((error) => {
          console.error('Error adding referral data to Google Sheets:', error);
        });
      }
    }

    return res.status(200).json({ name: creator.user.name });
  } catch (error) {
    console.log(error);
    return res.status(400).json({ message: 'Error updating creator', error: error.message });
  }
};

// Function to update client profile
export const updateClient = async (req: Request, res: Response) => {
  const { userid } = req.session;

  if (!userid) {
    return res.status(401).json({ message: 'User not authenticated' });
  }

  const { name, country, phoneNumber } = req.body;

  try {
    const user = await prisma.user.findUnique({
      where: {
        id: userid,
      },
      include: {
        client: true,
      },
    });

    if (!user) {
      return res.status(404).json({ message: 'Client Not Found' });
    }

    if (user.role !== 'client') {
      return res.status(403).json({ message: 'Access denied. User is not a client.' });
    }

    const updatedUser = await prisma.user.update({
      where: {
        id: userid,
      },
      data: {
        ...(name && { name }),
        ...(country && { country }),
        ...(phoneNumber && { phoneNumber }),
      },
    });

    return res.status(200).json({
      message: 'Client profile updated successfully',
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        country: updatedUser.country,
        phoneNumber: updatedUser.phoneNumber,
      },
    });
  } catch (error) {
    console.log(error);
    return res.status(400).json({ message: 'Error updating client profile', error: error.message });
  }
};

// Function to get user's information
export const getprofile = async (req: Request, res: Response) => {
  const userId = req.session.userid as string;
  const isImpersonating = req.session.isImpersonating;
  const impersonatingBy = req.session.impersonatingBy;
  let xeroinformation;

  if (!userId) {
    res.clearCookie('accessToken');
    res.clearCookie('userid');
    return res.status(401).json({ message: 'Unauthorized', sessionExpired: true });
  }

  try {
    const user = await getUser(userId);

    if (user?.role === 'admin' && user.admin?.role?.name?.toLowerCase() === 'finance') {
      await xero.initialize();

      const tokenSet = user.admin.xeroTokenSet as TokenSet;

      if (tokenSet) {
        xero.setTokenSet(tokenSet);

        if (dayjs.unix(tokenSet.expires_at!).isBefore(dayjs())) {
          const newTokenSet = await xero.refreshToken();

          await prisma.admin.update({
            where: {
              userId: user.id,
            },
            data: {
              xeroTokenSet: newTokenSet as any,
            },
          });
        }

        await xero.updateTenants();
        xeroinformation = xero.tenants;
      }
    }

    if (!user) return res.status(401).json({ message: 'Unauthorized' });

    switch (user?.status) {
      case 'banned':
        return res.status(400).json({ message: 'Account banned.' });
      case 'pending':
        return res.status(400).json({ message: 'Account pending.', role: user.role });
      case 'blacklisted':
        return res.status(400).json({ message: 'Account blacklisted.' });
      case 'suspended':
        return res.status(400).json({ message: 'Account suspended.' });
      case 'spam':
        return res.status(400).json({ message: 'Account spam.' });
      case 'rejected':
        return res.status(400).json({ message: 'Account rejected.' });
    }

    // Check if user is a child account
    const isChildAccount = await prisma.childAccount.findFirst({
      where: { email: user.email },
    });

    const { password, ...sanitizeUser } = user;

    return res.status(200).json({
      user: {
        ...sanitizeUser,
        xeroinformation,
        isChildAccount: !!isChildAccount,
        isImpersonating,
        impersonatingBy,
      },
    });
  } catch (error) {
    return res.status(404).json(error);
  }
};

// Login for both creator and admin
export const login = async (req: Request, res: Response) => {
  const { email, password }: RequestData = req.body;

  try {
    const data = await prisma.user.findFirst({
      where: {
        email: email.toLowerCase(),
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
            interests: true,
          },
        },
        pitch: true,
        shortlisted: true,
      },
    });

    if (!data) return res.status(404).json({ message: 'User not registered.' });

    switch (data.status) {
      case 'banned':
        return res.status(400).json({ message: 'Account banned.' });
      case 'pending':
        return res.status(400).json({ message: 'Account pending.' });
      case 'blacklisted':
        return res.status(400).json({ message: 'Account blacklisted.' });
      case 'suspended':
        return res.status(400).json({ message: 'Account suspended.' });
      case 'spam':
        return res.status(400).json({ message: 'Account spam.' });
      case 'rejected':
        return res.status(400).json({ message: 'Account rejected.' });
    }

    // // Hashed password
    const isMatch = data.password === password || (await bcrypt.compare(password, data.password as string));

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

    // Check if user is a child account
    const isChildAccount = await prisma.childAccount.findFirst({
      where: { email: data.email },
    });

    return res.status(200).json({
      user: {
        ...data,
        isChildAccount: !!isChildAccount,
      },
      accessToken: accessToken,
    });
  } catch (error) {
    console.log(error);
    return res.send(error);
  }
};

export const updateProfileCreator = async (req: Request, res: Response) => {
  const {
    name,
    email,
    phoneNumber,
    country,
    about,
    id,
    state,
    address,
    allergies,
    bodyMeasurement,
    pronounce,
    interests,
    removePhoto,
    city,
  } = JSON.parse(req.body.data);

  try {
    const creator = await prisma.creator.findFirst({
      where: {
        userId: id,
      },
      include: {
        user: {
          include: {
            paymentForm: true,
          },
        },
        interests: true,
      },
    });

    if (!creator) {
      return res.status(404).json({ message: 'Creator not found' });
    }

    await prisma.interest.deleteMany({
      where: {
        userId: creator.userId,
      },
    });

    // Then create new interests separately
    if (interests && interests.length > 0) {
      await prisma.interest.createMany({
        data: interests.map((interest: { name: string }) => ({
          name: interest.name,
          userId: creator.userId,
        })),
      });
    }

    const updateData: any = {
      state,
      address,
      pronounce,
      mediaKit: {
        upsert: {
          where: {
            creatorId: creator.id,
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
          name,
          email,
          phoneNumber,
          country,
          city,
          ...(removePhoto ? { photoURL: null } : {}),
        },
      },
    };

    // Handle file uploads if present
    if (req.files && ((req.files as any).backgroundImage || (req.files as any).image)) {
      const { image } = req?.files as any;
      const { backgroundImage } = req?.files as any;

      if (image) {
        const url = await uploadProfileImage(image.tempFilePath, image.name, 'creator');
        updateData.user.update.photoURL = url;
      }

      if (backgroundImage) {
        const urlBackground = await uploadProfileImage(backgroundImage.tempFilePath, backgroundImage.name, 'creator');
        updateData.user.update.photoBackgroundURL = urlBackground;
      }
    }

    // Update payment form
    await prisma.paymentForm.upsert({
      where: {
        userId: creator.user.id,
      },
      update: {
        bodyMeasurement: bodyMeasurement.toString(),
        allergies: allergies.map((allergy: { name: string }) => allergy.name),
      },
      create: {
        bodyMeasurement: bodyMeasurement.toString(),
        allergies: allergies.map((allergy: { name: string }) => allergy.name),
        user: {
          connect: {
            id: creator.user.id,
          },
        },
      },
    });

    // Update creator
    const updatedCreator = await prisma.creator.update({
      where: {
        userId: id,
      },
      data: updateData,

      include: {
        user: {
          include: {
            paymentForm: true,
          },
        },
        interests: true,
      },
    });

    return res.status(200).json({
      message: 'Profile updated successfully!',
      creator: updatedCreator,
    });
  } catch (error) {
    if (error instanceof Error) {
      console.error('Error updating creator:', error.message);
    }
    console.error('Error updating creator:', error);
    return res.status(400).json({
      message: 'Error updating creator',
      error: error.message,
    });
  }
};

export const resendVerificationLinkCreator = async (req: Request, res: Response) => {
  const { token } = req.body;

  if (!token) return res.status(404).json({ message: 'Token is missing' });

  try {
    const { jwtToken, user, id } = await getJWTToken(token as string);

    if (!jwtToken) return res.status(400).json({ message: 'Access token not found' });
    if (!user) return res.status(400).json({ message: 'User not found' });

    const decode = jwt.decode(jwtToken);

    if (!decode) return res.status(400).json({ message: 'Token is invalid' });

    const newToken = jwt.sign({ id: user.id }, process.env.ACCESSKEY as Secret, { expiresIn: '15m' });

    let shortCode;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      shortCode = generateRandomString();

      const isShortCodeExist = await prisma.emailVerification.findFirst({
        where: { shortCode },
      });

      if (!isShortCodeExist) break;
    }

    const newCode = await prisma.emailVerification.update({
      where: {
        id: id,
      },
      data: {
        token: newToken,
        shortCode: shortCode,
        expiredAt: dayjs().add(15, 'minute').toDate(),
      },
    });

    creatorVerificationEmail(user.email, newCode.shortCode);

    return res.status(200).json({ message: 'New verification link has been sent.' });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const resendVerificationLinkClient = async (req: Request, res: Response) => {
  const { token } = req.body;

  if (!token) return res.status(404).json({ message: 'Token is missing' });

  try {
    // Get JWT token and user information from the provided token
    const { jwtToken, user, id } = await getJWTToken(token as string);

    if (!jwtToken) return res.status(400).json({ message: 'Access token not found' });
    if (!user) return res.status(400).json({ message: 'User not found' });

    // Decode the JWT token to verify it's valid
    const decode = jwt.decode(jwtToken);

    if (!decode) return res.status(400).json({ message: 'Token is invalid' });

    // Create a new JWT token with 15 minutes expiration
    const newToken = jwt.sign({ id: user.id }, process.env.ACCESSKEY as Secret, { expiresIn: '15m' });

    let shortCode;

    // Generate a unique short code for the verification email
    // eslint-disable-next-line no-constant-condition
    while (true) {
      shortCode = generateRandomString();

      const isShortCodeExist = await prisma.emailVerification.findFirst({
        where: { shortCode },
      });

      if (!isShortCodeExist) break;
    }

    // Update the existing email verification record with new token and short code
    const newCode = await prisma.emailVerification.update({
      where: {
        id: id,
      },
      data: {
        token: newToken,
        shortCode: shortCode,
        expiredAt: dayjs().add(15, 'minute').toDate(),
      },
    });

    // Send the verification email with the new short code for clients
    clientVerificationEmail(user.email, newCode.shortCode);

    return res.status(200).json({ message: 'New verification link has been sent.' });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const inviteClient = async (req: Request, res: Response) => {
  const { email, companyId } = req.body;

  try {
    // Check if user already exists
    const existingUser = await prisma.user.findFirst({
      where: { email: email.toLowerCase() },
    });

    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // Get company information
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      include: { pic: true },
    });

    if (!company) {
      return res.status(404).json({ message: 'Company not found' });
    }

    // Create user with client role
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: email.toLowerCase(),
          password: '', // Empty password initially
          role: 'client',
          status: 'pending',
          name: company.name || 'Client User',
        },
      });

      // Get or create default client role
      let clientRole = await tx.role.findFirst({
        where: { name: 'Client' },
      });

      if (!clientRole) {
        clientRole = await tx.role.create({
          data: {
            name: 'Client',
          },
        });
      }

      // Generate invite token (7 day expiry)
      const inviteToken = jwt.sign({ id: user.id, companyId }, process.env.SESSION_SECRET as Secret, {
        expiresIn: '7d',
      });

      // Create admin record for client with Client role
      const admin = await tx.admin.create({
        data: {
          userId: user.id,
          roleId: clientRole.id,
          mode: 'normal',
        },
      });

      // Create client record linked to admin
      const client = await tx.client.create({
        data: {
          userId: user.id,
          inviteToken: inviteToken,
          companyId: companyId, // Add the companyId from request
        },
      });

      return { user, client, admin, company };
    });

    // Send invitation email
    ClientInvitation(result.user.email, result.client.inviteToken!, result.company.name);

    return res.status(200).json({
      message: 'Client invitation sent successfully',
      user: { email: result.user.email, id: result.user.id },
    });
  } catch (error) {
    console.error('Client invitation error:', error);
    return res.status(400).json({ message: 'Error sending client invitation' });
  }
};

export const verifyClientInvite = async (req: Request, res: Response) => {
  const { token } = req.query;

  try {
    // Verify JWT token
    const decoded = jwt.verify(token as string, process.env.SESSION_SECRET as string) as any;

    // Find client by token
    const client = await prisma.client.findFirst({
      where: { inviteToken: token as string },
      include: {
        user: true,
      },
    });

    if (!client) {
      return res.status(404).json({ message: 'Invalid or expired invitation' });
    }

    if (!client.user) {
      return res.status(404).json({ message: 'Missing user information' });
    }

    // Create session for the user so they can access the app
    const accessToken = jwt.sign({ id: client.user.id }, process.env.ACCESSKEY as Secret, {
      expiresIn: '4h',
    });

    const refreshToken = jwt.sign({ id: client.user.id }, process.env.REFRESHKEY as Secret);

    const session = req.session;
    session.userid = client.user.id;
    session.refreshToken = refreshToken;
    session.role = client.user.role;

    res.cookie('userid', client.user.id, {
      maxAge: 60 * 60 * 24 * 1000, // 1 Day
      httpOnly: true,
    });

    res.cookie('accessToken', accessToken, {
      maxAge: 60 * 60 * 4 * 1000, // 4 hours
      httpOnly: true,
    });

    // Return user info for password setup
    return res.status(200).json({
      message: 'Valid invitation',
      user: {
        id: client.user.id,
        email: client.user.email,
        name: client.user.name,
        role: client.user.role,
      },
      accessToken,
    });
  } catch (error) {
    console.error('Client invite verification error:', error);
    return res.status(400).json({ message: 'Invalid or expired invitation' });
  }
};

export const setupClientPassword = async (req: Request, res: Response) => {
  const { token, password, confirmPassword } = req.body;

  if (password !== confirmPassword) {
    return res.status(400).json({ message: 'Passwords do not match' });
  }

  try {
    // Verify token and get client
    const decoded = jwt.verify(token as string, process.env.SESSION_SECRET as string) as any;

    const client = await prisma.client.findFirst({
      where: { inviteToken: token },
      include: {
        user: true,
      },
    });

    if (!client) {
      return res.status(404).json({ message: 'Invalid or expired invitation' });
    }

    // Hash password and update user
    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await prisma.$transaction(async (tx) => {
      // Update user with password and activate
      const updatedUser = await tx.user.update({
        where: { id: client.user.id },
        data: {
          password: hashedPassword,
          status: 'active',
          isActive: true,
        },
      });

      // Clear the invite token after successful setup
      await tx.client.update({
        where: { id: client.id },
        data: {
          inviteToken: null,
        },
      });

      return updatedUser;
    });

    // Create session and tokens
    const accessToken = jwt.sign({ id: result.id }, process.env.ACCESSKEY as Secret, {
      expiresIn: '4h',
    });

    const refreshToken = jwt.sign({ id: result.id }, process.env.REFRESHKEY as Secret);

    const session = req.session;
    session.userid = result.id;
    session.refreshToken = refreshToken;
    session.role = result.role;

    res.cookie('userid', result.id, {
      maxAge: 60 * 60 * 24 * 1000, // 1 Day
      httpOnly: true,
    });

    res.cookie('accessToken', accessToken, {
      maxAge: 60 * 60 * 4 * 1000, // 4 hours
      httpOnly: true,
    });

    return res.status(200).json({
      message: 'Password set up successfully',
      user: result,
      accessToken,
    });
  } catch (error) {
    console.error('Password setup error:', error);
    return res.status(400).json({ message: 'Error setting up password' });
  }
};

export const deleteAccount = async (req: Request, res: Response) => {
  const userId = req.session.userid as string;

  if (!userId) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        creator: true,
        admin: true,
      },
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Delete all related data based on user role
    await prisma.$transaction(async (tx) => {
      // Common deletions for all users
      await tx.interest.deleteMany({ where: { userId } });
      await tx.invoice.deleteMany({ where: { creatorId: userId } });
      await tx.pitch.deleteMany({ where: { userId } });
      await tx.userNotification.deleteMany({ where: { userId } });
      await tx.notification.deleteMany({ where: { userId } });
      await tx.unreadMessage.deleteMany({ where: { userId } });
      await tx.seenMessage.deleteMany({ where: { userId } });
      await tx.bookMarkCampaign.deleteMany({ where: { userId } });
      await tx.paymentForm.deleteMany({ where: { userId } });
      await tx.userThread.deleteMany({ where: { userId } });
      await tx.creatorAgreement.deleteMany({ where: { userId } });
      await tx.submission.deleteMany({ where: { userId } });
      // await tx.logistic.deleteMany({ where: { userId } });

      // Role-specific deletions
      if (user.role === 'creator') {
        await tx.creator.delete({
          where: { userId },
          include: { mediaKit: true },
        });
      } else if (user.role === 'admin') {
        await tx.admin.delete({ where: { userId } });
      }

      // Finally delete the user
      await tx.user.delete({ where: { id: userId } });
    });

    // Clear session and cookies
    req.session.destroy((err) => {
      if (err) {
        return res.status(400).json({ message: 'Error logging out' });
      }
      res.clearCookie('userid');
      res.clearCookie('accessToken');
      return res.status(200).json({ message: 'Account deleted successfully' });
    });
  } catch (error) {
    console.error(error);
    return res.status(400).json({ message: 'Failed to delete account' });
  }
};

export const setupTwoFactor = async (req: Request, res: Response) => {
  try {
    const userId = req.session.userid;

    const user = await prisma.user.findUnique({
      where: {
        id: userId,
      },
    });

    if (!user) return res.status(404).json({ message: 'User not found' });

    const secret = generateSecret();

    const uri = generateURI({
      issuer: 'Cult Creative Application',
      label: user.email.trim().toLowerCase(),
      secret,
    });

    const qrDataUrl = await QRCode.toDataURL(uri);

    console.log(qrDataUrl);
  } catch (error) {
    return res.status(500).json(error);
  }
};

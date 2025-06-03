import { Response, NextFunction } from 'express';
import { verify } from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import dayjs from 'dayjs';

const prisma = new PrismaClient();

export const validateToken = (req: any, res: Response, next: NextFunction) => {
  const accessToken = req.cookies['accessToken'];

  if (!accessToken) return res.status(400).json({ error: 'User not Authenticated!' });

  try {
    const validToken = verify(accessToken, process.env.ACCESSKEY as string);
    if (validToken) {
      req.authenticated = true;
      req.user = validToken;
      return next();
    }
  } catch (err) {
    return res.status(400).json({ error: err });
  }
};

export const verifyToken = (token: string) => {
  if (!token) {
    throw new Error('Token is required');
  }

  try {
    const validToken = verify(token, process.env.ACCESSKEY as string);
    return validToken;
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw new Error('Token has expired. Please request a new one.');
    }
    if (err.name === 'JsonWebTokenError') {
      throw new Error('Invalid token.');
    }
    throw new Error('Error verifying token.');
  }
};

export const getJWTToken = async (token: string) => {
  try {
    const jwtToken = await prisma.emailVerification.findFirst({
      where: {
        shortCode: token,
      },
      include: {
        user: true,
      },
    });

    if (!jwtToken) throw new Error('Shortcode not found');
    if (dayjs(jwtToken.expiredAt).isBefore(dayjs(), 'date')) throw new Error('Shortcode expired');

    return { jwtToken: jwtToken.token, user: jwtToken.user, id: jwtToken.id };
  } catch (error) {
    throw new Error(error);
  }
};

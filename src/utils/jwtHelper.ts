import { Response, NextFunction } from 'express';
import { verify } from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import dayjs from 'dayjs';

const prisma = new PrismaClient();

export const validateToken = async (req: any, res: Response, next: NextFunction) => {
  const accessToken = req.cookies['accessToken'];

  if (!accessToken) return res.status(400).json({ error: 'User not Authenticated!' });

  let validToken: { id?: string; userId?: string };
  try {
    validToken = verify(accessToken, process.env.ACCESSKEY as string) as { id?: string; userId?: string };
  } catch {
    return res.status(400).json({ error: 'User not Authenticated!' });
  }

  // Every signing site puts the user id in `id` (web) or `userId` (mobile);
  // a token with neither is not one of ours.
  const userId = validToken.id || validToken.userId;

  if (!userId) return res.status(401).json({ error: 'User not Authenticated!' });

  let user;
  try {
    user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, status: true },
    });
  } catch {
    // DB failure is not an auth failure — a 4xx here would bounce users off
    // the web auth bootstrap (/api/auth/currentUser) during an outage.
    return res.status(503).json({ error: 'Service temporarily unavailable' });
  }

  if (!user) return res.status(401).json({ error: 'User not Authenticated!' });

  if (user.status === 'deleted') {
    res.clearCookie('accessToken');
    res.clearCookie('userid');
    return res.status(401).json({ message: 'Account not found.' });
  }

  req.authenticated = true;
  req.user = validToken;
  return next();
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

// utils/tokens.ts
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

const ACCESS_TOKEN_SECRET = process.env.ACCESSKEY!;
const REFRESH_TOKEN_SECRET = process.env.REFRESHKEY!;
const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY = '30d';
const REFRESH_TOKEN_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

export const hashToken = (token: string): string => crypto.createHash('sha256').update(token).digest('hex');

export const generateAccessToken = (payload: { userId: string; email: string }): string =>
  jwt.sign(payload, ACCESS_TOKEN_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });

export const generateRefreshToken = (payload: { userId: string; familyId: string }): string =>
  jwt.sign(payload, REFRESH_TOKEN_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRY });

export const verifyAccessToken = (token: string) =>
  jwt.verify(token, ACCESS_TOKEN_SECRET) as { userId: string; email: string };

export const verifyRefreshToken = (token: string) =>
  jwt.verify(token, REFRESH_TOKEN_SECRET) as {
    userId: string;
    email: string;
  };

export const getRefreshTokenExpiryDate = (): Date => new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS);

import { Response, NextFunction } from 'express';
import { verify } from 'jsonwebtoken';

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

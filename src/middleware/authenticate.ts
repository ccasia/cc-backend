// middleware/authenticate.ts
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      authMethod: 'session' | 'jwt';
    }
  }
}

export const authenticate = (req: Request, res: Response, next: NextFunction) => {
  // 1. Try session-based auth first (web)

  if (req.session?.userid) {
    req.userId = req.userId;
    req.authMethod = 'session';
    return next();
  }

  // 2. Try JWT (mobile)
  const authHeader = req.headers.authorization;

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const payload = jwt.verify(token, process.env.ACCESSKEY!) as {
        userId: string;
      };
      req.userId = payload.userId;
      req.authMethod = 'jwt';
      return next();
    } catch {
      console.log('ASDASD');
      return res.status(401).json({ success: false, message: 'Invalid or expired token' });
    }
  }

  // 3. Neither worked
  return res.status(401).json({ success: false, message: 'Unauthorized', sessionExpired: true });
};

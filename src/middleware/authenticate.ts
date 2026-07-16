// middleware/authenticate.ts
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '@/src/prisma/prisma';

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      authMethod: 'session' | 'jwt';
    }
  }
}

const validateActiveUser = async (userId: string) =>
  prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, status: true },
  });

// DB failures must NOT read as auth failures — a 401 here makes clients drop
// their tokens and sign the user out, so a transient outage would log out
// everyone at once. Surface it as 503 and let them retry.
const dbUnavailable = (res: Response) =>
  res.status(503).json({ success: false, message: 'Service temporarily unavailable' });

export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
  // 1. Try session-based auth first (web)

  if (req.session?.userid) {
    let user;
    try {
      user = await validateActiveUser(req.session.userid);
    } catch {
      return dbUnavailable(res);
    }

    if (!user) {
      return res.status(401).json({ success: false, message: 'Unauthorized', sessionExpired: true });
    }

    if (user.status === 'deleted') {
      return req.session.destroy(() => {
        res.clearCookie('userid');
        res.clearCookie('accessToken');
        return res.status(401).json({ success: false, message: 'Account not found.' });
      });
    }

    req.userId = user.id;
    req.authMethod = 'session';
    return next();
  }

  // 2. Try JWT (mobile)
  const authHeader = req.headers.authorization;

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];

    let payload: { userId: string };
    try {
      payload = jwt.verify(token, process.env.ACCESSKEY!) as { userId: string };
    } catch {
      return res.status(401).json({ success: false, message: 'Invalid or expired token' });
    }

    let user;
    try {
      user = await validateActiveUser(payload.userId);

      if (user?.status === 'deleted') {
        await prisma.refreshToken.deleteMany({ where: { userId: user.id } });

        return res.status(401).json({ success: false, message: 'Account not found.' });
      }
    } catch {
      return dbUnavailable(res);
    }

    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid or expired token' });
    }

    req.userId = user.id;
    req.authMethod = 'jwt';
    return next();
  }

  // 3. Neither worked
  return res.status(401).json({ success: false, message: 'Unauthorized', sessionExpired: true });
};

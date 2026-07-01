import { NextFunction, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const isSalesAndMarketing = async (req: Request, res: Response, next: NextFunction) => {
  const userId = req.userId;
  if (!userId) {
    return res.status(401).json({ message: 'You are not logged in' });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      admin: {
        include: {
          role: true,
        },
      },
    },
  });

  if (!user || !user.admin) {
    return res.status(404).json({ message: 'Forbidden: Insufficient permissions.' });
  }

  const { mode, role } = user.admin;
  const allowed =
    mode === 'god' ||
    mode === 'advanced' ||
    role?.name === 'CSM' ||
    role?.name === 'CSL' ||
    role?.slug === 'sales_and_marketing';

  if (!allowed) {
    return res.status(404).json({ message: 'Forbidden: Insufficient permissions.' });
  }

  return next();
};

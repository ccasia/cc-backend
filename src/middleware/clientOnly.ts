import { NextFunction, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const isClient = async (req: Request, res: Response, next: NextFunction) => {
  // Check if client is logged in
  const userId = req.session.userid;
  if (!userId) {
    return res.status(401).json({ message: 'You are not logged in' });
  }

  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },
    include: {
      client: true,
    },
  });

  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }

  if (user.role !== 'client' as any) {
    return res.status(403).json({ message: 'Access denied: Client access required' });
  }

  next();
};
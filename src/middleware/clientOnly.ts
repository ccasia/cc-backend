import { NextFunction, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const isClient = async (req: Request, res: Response, next: NextFunction) => {
  // Check if client is logged in
  const userId = req.session.userid;
  if (!userId) {
    console.log('Client middleware: No user ID in session');
    return res.status(401).json({ message: 'You are not logged in' });
  }

  console.log('Client middleware: Checking user with ID', userId);

  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },
    include: {
      client: true,
    },
  });

  if (!user) {
    console.log('Client middleware: User not found');
    return res.status(404).json({ message: 'User not found' });
  }

  console.log('Client middleware: User role is', user.role);
  console.log('Client middleware: Client data is', user.client);

  if (user.role !== 'client') {
    console.log('Client middleware: User is not a client, role is', user.role);
    return res.status(403).json({ message: 'Access denied: Client access required' });
  }

  if (!user.client) {
    console.log('Client middleware: User has client role but no client record');
    return res.status(403).json({ message: 'Access denied: Client record not found' });
  }

  next();
};
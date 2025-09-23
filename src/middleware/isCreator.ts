import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const isCreator = async (req: Request, res: Response, next: NextFunction) => {
  const userId = req.session.userid;

  if (!userId) {
    return res.status(401).json({ message: 'You are not logged in' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true }
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.role !== 'creator') {
      return res.status(403).json({ 
        message: 'Access denied: Creator access required' 
      });
    }

    next();
  } catch (error) {
    console.error('Error in isCreator middleware:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

export const isCreatorOrClient = async (req: Request, res: Response, next: NextFunction) => {
  const userId = req.session.userid;

  if (!userId) {
    return res.status(401).json({ message: 'You are not logged in' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true }
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.role !== 'creator' && user.role !== 'client') {
      return res.status(403).json({ 
        message: 'Access denied: Creator or client access required' 
      });
    }

    next();
  } catch (error) {
    console.error('Error in isCreatorOrClient middleware:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};
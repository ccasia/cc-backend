import { NextFunction, Request, Response } from 'express';

import { prisma } from '../prisma/prisma';

// Guards routes that only a client_demo session may reach. Runs after
// `authenticate` (which sets req.userId). A demo user must have role
// `client_demo` AND a Client record of clientType `demoClient`.
export const isClientDemo = async (req: Request, res: Response, next: NextFunction) => {
  const userId = req.userId;
  if (!userId) {
    return res.status(401).json({ message: 'You are not logged in' });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { client: true },
  });

  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }

  if (user.role !== 'client_demo' || user.client?.clientType !== 'demoClient') {
    return res.status(403).json({ message: 'Access denied: Demo client access required' });
  }

  next();
};

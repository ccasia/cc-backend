import { NextFunction, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const needPermissions = (permissions: string[]) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Check if admin is logged in
    const userid = req.session.userid;
    if (!userid) {
      return res.status(400).json({ message: 'You are not logged in' });
    }

    const user = await prisma.user.findUnique({
      where: {
        id: userid,
      },
      include: {
        admin: {
          include: {
            role: {
              include: {
                permissions: true,
              },
            },
          },
        },
      },
    });

    if (!user) {
      return res.status(400).json({ message: 'User not found' });
    }

    if (user.admin?.mode === 'god') {
      return next();
    }

    const extractedPermissions = user.admin?.role?.permissions.map((permission) => permission.name);

    if (!permissions.every((permission) => extractedPermissions?.includes(permission))) {
      return res.status(404).json({ message: 'Forbidden: Insufficient permissions.' });
    }

    next();
  };
};

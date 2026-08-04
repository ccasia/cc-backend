import { NextFunction, Request, Response } from 'express';

import { prisma } from '../prisma/prisma';

// Strict superadmin guard for treasure-hunt administration. Unlike
// onlySuperadmin.isSuperAdmin (which also lets ordinary admins in god/advanced
// mode through), this checks the User.role column and admits ONLY superadmins.
export const createIsTreasureHuntSuperadmin =
  ({ prisma: db }: { prisma: any }) =>
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const user = await db.user.findUnique({
      where: { id: req.userId },
      select: { role: true },
    });

    if (user?.role !== 'superadmin') {
      return res.status(403).json({ success: false, message: 'Superadmin access required.' });
    }

    return next();
  };

export const isTreasureHuntSuperadmin = createIsTreasureHuntSuperadmin({ prisma });

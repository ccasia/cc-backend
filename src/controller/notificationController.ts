import { Entity, PrismaClient } from '@prisma/client';
import { Request, Response } from 'express';

const prisma = new PrismaClient();

export enum Title {
  Update,
  Create,
  Delete,
}

export const saveNotification = async (userId: string, message: string, entity: Entity, entityId?: string) => {
  if (entity === 'Campaign' && entityId) {
    return prisma.notification.create({
      data: {
        message: message,
        entity: entity,
        campaign: {
          connect: {
            id: entityId || '',
          },
        },
        notificationStatus: {
          create: {
            userId: userId,
          },
        },
      },
      include: {
        notificationStatus: {
          select: {
            userId: true,
          },
        },
      },
    });
  } else if (entity === 'Pitch' && !entityId) {
    return prisma.notification.create({
      data: {
        message: message,
        entity: entity,
        notificationStatus: {
          create: {
            userId: userId,
          },
        },
      },
      include: {
        notificationStatus: {
          select: {
            userId: true,
          },
        },
      },
    });
  }
  return prisma.notification.create({
    data: {
      message: message,
      entity: entity,
      notificationStatus: {
        create: {
          userId: userId,
        },
      },
    },
    include: {
      notificationStatus: {
        select: {
          userId: true,
        },
      },
    },
  });
};

export const getNotificationByUserId = async (req: Request, res: Response) => {
  const { userid } = req.session;
  try {
    const notifications = await prisma.notificationStatus.findMany({
      where: {
        userId: userid,
      },
      include: {
        notification: {
          include: {
            campaign: true,
          },
        },
      },
    });

    return res.status(200).json({ notifications });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const markAllAsRead = async (req: Request, res: Response) => {
  const { userid } = req.session;
  try {
    await prisma.notificationStatus.updateMany({
      where: {
        userId: userid,
      },
      data: {
        read: true,
      },
    });
    return res.sendStatus(200);
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const archiveAll = async (req: Request, res: Response) => {
  const { userid } = req.session;
  try {
    await prisma.notificationStatus.updateMany({
      where: {
        userId: userid,
      },
      data: {
        archive: true,
        read: true,
      },
    });
    return res.sendStatus(200);
  } catch (error) {
    return res.status(400).json(error);
  }
};

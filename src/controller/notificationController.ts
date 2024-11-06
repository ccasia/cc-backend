import { Entity, PrismaClient } from '@prisma/client';
import { Request, Response } from 'express';


const prisma = new PrismaClient();

export enum Title {
  Update,
  Create,
  Delete,
}

export const saveNotification = async ({
  userId,
  campaignId,
  message,
  entity,
  entityId,
  title,
  pitchId,
  creatorId,
  type,
  threadId,
}: {
  userId: string;
  campaignId?: string;
  creatorId?: string;
  message: string;
  entity: Entity;
  entityId?: string;
  title?: string;
  pitchId?: string;
  type?: string;
  threadId?: string;
}) => {
  if (entity === 'Agreement' || entity === 'Draft' || entity === 'Timeline' || entity === 'Post') {
    return prisma.notification.create({
      data: {
        message: message,
        title: title,
        entity: entity,
        campaignId: entityId,
        creatorId: creatorId,
        userNotification: {
          create: {
            userId: userId,
          },
        },
      },
      include: {
        userNotification: {
          select: {
            userId: true,
          },
        },
      },
    });
  }


  if (entity === 'Invoice'){
    return prisma.notification.create({
      data: {
        message: message,
        title: title,
        entity: entity,
        threadId: threadId,
        //invoiceId: invoiceId,
        userNotification: {
          create: {
            userId: userId,
          },
        },
      },
      include: {
        userNotification: {
          select: {
            userId: true,
          },
        },
      },
    });
  }
  if (entity === 'Chat') {
    if (entityId) {
      // Case: Chat with a campaign, connect campaignId
      return prisma.notification.create({
        data: {
          message: message,
          title: title,
          entity: entity,
          threadId: threadId,
          campaign: {
            connect: {
              id: entityId,
            },
          },
          userNotification: {
            create: {
              userId: userId,
            },
          },
        },
        include: {
          userNotification: {
            select: {
              userId: true,
            },
          },
        },
      });
    } else {
      // Case: Chat without a campaign, only use threadId
      return prisma.notification.create({
        data: {
          message: message,
          title: title,
          entity: entity,
          threadId: threadId,
          userNotification: {
            create: {
              userId: userId,
            },
          },
        },
        include: {
          userNotification: {
            select: {
              userId: true,
            },
          },
        },
      });
    }
  }
  
  if (entity && entityId) {
    return prisma.notification.create({
      data: {
        message: message,
        title: title,
        entity: entity,
        campaign: {
          connect: {
            id: entityId || '',
          },
        },
        userNotification: {
          create: {
            userId: userId,
          },
        },
      },
      include: {
        userNotification: {
          select: {
            userId: true,
          },
        },
      },
    });
  }

  if (pitchId && entity) {
    return prisma.notification.create({
      data: {
        message: message,
        title: title,
        entity: entity,
        pitchId: pitchId,
        userNotification: {
          create: {
            userId: userId,
          },
        },
      },
      include: {
        userNotification: {
          select: {
            userId: true,
          },
        },
      },
    });
  }

  if (creatorId && entity) {
    return prisma.notification.create({
      data: {
        message: message,
        title: title,
        entity: entity,
        creatorId: creatorId,
        userNotification: {
          create: {
            userId: userId,
          },
        },
      },
      include: {
        userNotification: {
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
      title: title,
      userNotification: {
        create: {
          userId: userId,
        },
      },
    },
    include: {
      userNotification: {
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
    const notifications = await prisma.userNotification.findMany({
      where: {
        userId: userid,
      },
      include: {
        notification: {
          include: {
            campaign: true,
            pitch: true,
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
    await prisma.userNotification.updateMany({
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
    await prisma.userNotification.updateMany({
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

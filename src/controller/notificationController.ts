import { Entity, PrismaClient } from '@prisma/client';
import { Request, Response } from 'express';

import { sendExpoPushToUser } from '../helper/expoPush';

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
  invoiceId,
  submissionId,
  sendPush = true,
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
  invoiceId?: string;
  submissionId?: string;
  sendPush?: boolean;
}) => {
  if (sendPush) {
    // Fire-and-forget push notification (does not block DB write)
    void sendExpoPushToUser(userId, {
      title: title ?? 'New notification',
      body: message,
      data: { entity, campaignId: campaignId ?? entityId, pitchId, threadId, invoiceId, submissionId },
    });
  }

  if (entity === 'Agreement' || entity === 'Draft' || entity === 'Timeline' || entity === 'Post') {
    return prisma.notification.create({
      data: {
        message: message,
        title: title,
        entity: entity,
        campaignId: entityId,
        submissionId: submissionId,
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

  if (entity === 'Invoice') {
    return prisma.notification.create({
      data: {
        message: message,
        title: title,
        entity: entity,
        threadId: threadId,
        invoiceId: invoiceId,
        campaignId: campaignId ?? entityId,
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
        ...(submissionId ? { submission: { connect: { id: submissionId } } } : {}),
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
        campaign: {
          select: {
            name: true,
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
  const userid = req.userId;
  try {
    const notifications = await prisma.userNotification.findMany({
      where: {
        userId: userid,
      },
      include: {
        notification: {
          include: {
            campaign: {
              include: {
                campaignBrief: { select: { images: true } },
                company: { select: { id: true, name: true, logo: true } },
                brand: { select: { id: true, name: true, logo: true } },
              },
            },
            pitch: true,
          },
        },
      },
      orderBy: {
        notification: {
          createdAt: 'desc',
        },
      },
    });

    return res.status(200).json({ notifications });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const markAllAsRead = async (req: Request, res: Response) => {
  const userid = req.userId;
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

export const markAsRead = async (req: Request, res: Response) => {
  const { id } = req.params;
  const userid = req.userId;

  try {
    const userNotification = await prisma.userNotification.findUnique({
      where: { id },
    });

    if (!userNotification || userNotification.userId !== userid) {
      return res.status(404).json({ error: 'UserNotification record not found or unauthorized.' });
    }

    const updatedNotification = await prisma.userNotification.update({
      where: { id },
      data: {
        read: true,
        readAt: new Date(),
      },
    });

    console.log(`Notification with ID ${id} marked as read for user ${userid}.`);
    return res.status(200).json({ message: 'Notification marked as read', notification: updatedNotification });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    return res.status(400).json({ error: 'Error marking notification as read' });
  }
};

export const archiveAll = async (req: Request, res: Response) => {
  const userid = req.userId;
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

import { Request, Response } from 'express';
import { createNotification, getNotificationsById } from '../service/notificationService';

// import { PrismaClient, NotificationType, category } from '@prisma/client';

// const prisma = new PrismaClient();

export const getNotificationsByIdController = async (req: Request, res: Response) => {
  const userId = req.session.userid;
  if (!userId) {
    return res.status(400).json({ message: 'Not authenticated.' });
  }
  try {
    const notifications = await getNotificationsById(userId);
    return res.status(200).json(notifications);
  } catch (error) {
    return res.status(404).json(error);
  }
};

export const createNotificationController = async (req: Request, res: Response) => {
  console.log(req.body);
  try {
    await createNotification(req.body);
    return res.status(200).json({ message: 'New notification is created!' });
  } catch (error) {
    console.log(error);
    return res.status(400).json(error);
  }
};

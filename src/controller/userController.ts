import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

import { updateUser } from 'src/service/userServices';

const prisma = new PrismaClient();

export const updateProfile = async (req: Request, res: Response) => {
  //   const { name, email, password, photoURL, designation, country, phoneNumber } = req.body;
  try {
    await updateUser(req.body);
    res.status(200).json({ message: 'Successfully updated' });
  } catch (error) {
    res.send(error);
  }
};

export const approveOrReject = async (req: Request, res: Response) => {
  const { approve } = req.body;

  try {
    if (approve) {
      await prisma.notification.create({
        data: {
          receiver_id: 1,
          content: 'Your pitch has been approved',
        },
      });
      return res.send('You pitch has been approved');
    }
    await prisma.notification.create({
      data: {
        receiver_id: 1,
        content: 'Your pitch has been rejected',
      },
    });
    return res.send('You pitch has been rejected');
  } catch (error) {
    res.end(error);
  }
};

export const getAllNotification = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const data = await prisma.notification.findMany({
      where: {
        receiver_id: parseInt(id),
      },
    });

    if (data.length < 1) {
      return res.send('No notifcation');
    }

    return res.send(data);
  } catch (error) {
    return res.send(error);
  }
};

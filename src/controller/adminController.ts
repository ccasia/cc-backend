import { Request, Response } from 'express';
import { handleDeleteAdminById } from '@services/adminService';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const deleteAdminById = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    await handleDeleteAdminById(id);
    return res.status(200).json({ message: 'Admin deleted.' });
  } catch (err) {
    return res.status(400).json({ message: err });
  }
};

export const disconnectXero = async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: {
        id: req.session.userid,
      },
    });

    if (!user) return res.status(404).json({ message: 'User not found' });

    console.log('asd');
  } catch (error) {
    console.log(error);
    return res.status(400).json({ message: 'Failed to disconnect xero' });
  }
};

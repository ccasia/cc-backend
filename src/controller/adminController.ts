import { Request, Response } from 'express';
import { handleDeleteAdminById } from '@services/adminService';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const getAllAdmins = async (req: Request, res: Response) => {
  try {
    const admins = await prisma.admin.findMany({
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            photoURL: true,
          },
        },
        role: true,
      },
    });

    return res.status(200).json(admins);
  } catch (error) {
    console.error('Error fetching admins:', error);
    return res.status(500).json({ message: 'Failed to fetch admins', error });
  }
};

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

export const impersonateCreator = async (req: Request<{}, {}, { userId: string }>, res: Response) => {
  try {
    const userId = req.body.userId;
    const sessionUserId = req.session.userid;

    if (!userId) return res.status(404).json({ message: 'userId is required', success: false });

    const creator = await prisma.user.findUnique({ where: { id: userId } });

    if (!creator) return res.status(404).json({ success: false, message: 'Creator not found' });
    if (creator.role != 'creator')
      return res.status(404).json({ success: false, message: 'Cannot impersonate other administrators' });

    const admin = await prisma.user.findUnique({ where: { id: sessionUserId } });
    if (!admin) return res.status(404).json({ success: false, message: 'Admin not found' });

    // req.session.destroy((err) => {
    //   if (err) {
    //     return res.status(400).json({ message: 'Error logging out' });
    //   }
    //   res.clearCookie('connect.sid');
    //   res.clearCookie('userid');
    //   res.clearCookie('accessToken');
    // });

    const session = req.session;
    session.isImpersonating = true;
    session.impersonatingBy = admin.name!;
    session.userid = creator.id;

    res.cookie('userid', creator.id, {
      maxAge: 60 * 60 * 24 * 1000, // 1 Day
      httpOnly: true,
    });

    return res.sendStatus(200);
  } catch (error) {
    return res.status(500).json(error);
  }
};

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

    const session = req.session;
    session.isImpersonating = true;
    session.impersonatingBy = { userId: admin.id, name: admin.name! };
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

// export const endImpersonatingSession = async (req: Request, res: Response) => {
//   try {
//     const isImpersonating = req.session.isImpersonating;
//     const impersonatingBy = req.session.impersonatingBy;

//     if (!isImpersonating) return res.status(200).json({ message: 'Not in impersonating session' });

//     const adminId = impersonatingBy?.userId;

//     const admin = await prisma.admin.findFirst({
//       where: {
//         userId: adminId,
//       },
//       include: {
//         user: true,
//       },
//     });

//     if (!admin) return res.status(404).json({ message: 'Admin not found', success: false });

//     const session = req.session;
//     session.isImpersonating = false;
//     session.impersonatingBy = null;
//     session.userid = admin.userId;
//     session.role = admin.user.role!;
//     session.name = admin.user.name || '';
//     session.photoURL = admin.user.photoURL || '';

//     session.save((err) => {
//       if (err) {
//         console.log(err);
//       }

//       res.cookie('userid', admin.userId, {
//         maxAge: 60 * 60 * 24 * 1000, // 1 Day
//         httpOnly: true,
//       });
//     });

//     return res.sendStatus(200);
//   } catch (error) {
//     return res.status(500).json(error);
//   }
// };

export const endImpersonatingSession = async (req: Request, res: Response) => {
  try {
    const isImpersonating = req.session.isImpersonating;
    const impersonatingBy = req.session.impersonatingBy;

    if (!isImpersonating) {
      return res.status(200).json({ message: 'Not in impersonating session' });
    }

    const adminId = impersonatingBy?.userId;

    const admin = await prisma.admin.findFirst({
      where: {
        userId: adminId,
      },
      include: {
        user: true,
      },
    });

    if (!admin) {
      return res.status(404).json({ message: 'Admin not found', success: false });
    }

    // Update session
    req.session.isImpersonating = false;
    req.session.impersonatingBy = null;
    req.session.userid = admin.userId;
    req.session.role = admin.user.role!;
    req.session.name = admin.user.name || '';
    req.session.photoURL = admin.user.photoURL || '';

    // Explicitly save session before responding
    req.session.save((err) => {
      if (err) {
        return res.status(500).json({ message: 'Session save failed', error: err });
      }

      res.cookie('userid', admin.userId, {
        maxAge: 60 * 60 * 24 * 1000, // 1 Day
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production', // Add this
        sameSite: 'lax', // Add this
      });

      return res.status(200).json({ message: 'Impersonation ended successfully' });
    });
  } catch (error) {
    return res.status(500).json({ message: 'Internal server error', error });
  }
};

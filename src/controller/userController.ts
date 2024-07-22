import { Request, Response } from 'express';
import { AdminInvite } from 'src/config/nodemailer.config';

import {
  // createNewAdmin,
  findUserByEmail,
  handleGetAdmins,
  updateAdmin,
  updateNewAdmin,
  createAdminForm,
  createNewAdmin,
  // createNewAdmin,
} from 'src/service/userServices';
import { Storage } from '@google-cloud/storage';
import { Entity, PrismaClient } from '@prisma/client';
import { Title, saveNotification } from './notificationController';
// import { serializePermission } from '@utils/serializePermission';

const storage = new Storage({
  keyFilename: 'src/config/test-cs.json',
});

const bucket = storage.bucket('app-test-cult-cretive');

const prisma = new PrismaClient();

export const updateProfileAdmin = async (req: Request, res: Response) => {
  const { files } = req;
  const body = req.body;

  const permission = body.permission;

  try {
    if (files && files.image) {
      const { image } = files as any;
      bucket.upload(image.tempFilePath, { destination: `profile/${image.name}` }, async (err, file) => {
        if (err) {
          return err;

          // return res.status(500).json({ message: 'Error uploading image.' });
        }
        file?.makePublic(async (err) => {
          if (err) {
            return err;
            // return res.status(500).json({ message: 'Error uploading image.' });
          }
          const publicURL = file.publicUrl();
          await updateAdmin(req.body, permission, publicURL);
        });
      });
    } else {
      await updateAdmin(req.body, permission);
    }
    // saveNotification(req.body.userId, Title.Update, 'Profile Updated', Entity.User);
    return res.status(200).json({ message: 'Successfully updated' });
  } catch (error) {
    console.log(error);
    return res.status(400).json({ message: error });
  }
};

// Only superadmin is allow to run this function
export const getAdmins = async (req: Request, res: Response) => {
  const userid = req.session.userid;
  try {
    const data = await handleGetAdmins(userid as string);
    res.status(200).send(data);
  } catch (error) {
    res.status(400).json({ message: error });
  }
};

// export const approveOrReject = async (req: Request, res: Response) => {
//   const { approve } = req.body;

//   try {
//     if (approve) {
//       await prisma.notification.create({
//         data: {
//           receiver_id: 1,
//           content: 'Your pitch has been approved',
//         },
//       });
//       return res.send('You pitch has been approved');
//     }
//     await prisma.notification.create({
//       data: {
//         receiver_id: 1,
//         content: 'Your pitch has been rejected',
//       },
//     });
//     return res.send('You pitch has been rejected');
//   } catch (error) {
//     res.end(error);
//   }
// };

// export const getAllNotification = async (req: Request, res: Response) => {
//   const { id } = req.params;
//   try {
//     const data = await prisma.notification.findMany({
//       where: {
//         receiver_id: parseInt(id),
//       },
//     });

//     if (data.length < 1) {
//       return res.send('No notifcation');
//     }

//     return res.send(data);
//   } catch (error) {
//     return res.send(error);
//   }
// };

export const inviteAdmin = async (req: Request, res: Response) => {
  const { email, permission } = req.body;

  try {
    const user = await findUserByEmail(email);
    if (user) {
      return res.status(400).json({ message: 'User already registered' });
    }
    const response = await createNewAdmin(email, permission);
    AdminInvite(response?.user.email as string, response?.admin.inviteToken as string);
    res.status(200).send(response);
  } catch (error) {
    res.status(404).send(error);
  }
};

export const createAdmin = async (req: Request, res: Response) => {
  try {
    const user = await findUserByEmail(req.body.email);
    if (user) {
      return res.status(400).json({ message: 'User already registered' });
    }

    const result = await createAdminForm(req.body);
    AdminInvite(result?.user.email as string, result?.admin.inviteToken as string);

    res.status(200).json({ message: 'Successfully created', result });
  } catch (error) {
    res.status(404).send(error);
  }
};

export const updateAdminInformation = async (req: Request, res: Response) => {
  try {
    const result = await updateNewAdmin(req.body);
    res.status(200).json({ message: 'Successfully updated', result });
  } catch (error) {
    console.log(error);
    res.status(404).send(error);
  }
};

export const getAllActiveAdmins = async (_req: Request, res: Response) => {
  try {
    const admins = await prisma.user.findMany({
      where: {
        NOT: {
          role: 'creator',
        },
        status: 'active',
      },
      select: {
        id: true,
        name: true,
        status: true,
        phoneNumber: true,
        country: true,
        email: true,
        admin: {
          include: {
            AdminPermissionModule: {
              select: {
                permission: true,
                module: true,
              },
            },
          },
        },
      },
    });

    return res.status(200).json(admins);
  } catch (error) {
    return res.status(400).json(error);
  }
};

import { Request, Response } from 'express';
import { AdminInvite } from 'src/config/nodemailer.config';

import { createNewAdmin, findUserByEmail, handleGetAdmins, updateNewAdmin, updateUser } from 'src/service/userServices';

export const updateProfile = async (req: Request, res: Response) => {
  //   const { name, email, password, photoURL, designation, country, phoneNumber } = req.body;
  try {
    await updateUser(req.body);
    res.status(200).json({ message: 'Successfully updated' });
  } catch (error) {
    res.status(400).json({ message: error });
  }
};

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
  const { email } = req.body;
  try {
    const user = await findUserByEmail(email);
    if (user) {
      return res.status(400).json({ message: 'User already registered' });
    }
    const response = await createNewAdmin(email);
    AdminInvite(response?.user.email as string, response?.admin.inviteToken as string);
    res.status(200).send(response);
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

import { Request, Response } from 'express';

import { updateUser } from 'src/service/userServices';

export const updateProfile = async (req: Request, res: Response) => {
  //   const { name, email, password, photoURL, designation, country, phoneNumber } = req.body;
  try {
    await updateUser(req.body);
    res.status(200).json({ message: 'Successfully updated' });
  } catch (error) {
    res.send(error);
  }
};

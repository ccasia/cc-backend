import { Request, Response } from 'express';
import { registerUser } from 'src/service/RegisterService';

export const register = async (req: Request, res: Response) => {
  const { name } = req.body;
  if (!name) {
    return res.status(404).send('Please insert your name');
  }
  await registerUser(name);
  return res.status(202).send('Successfully registered');
};

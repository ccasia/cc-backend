import { Request, Response } from 'express';
import { getClientHome } from './client-home.service';

export const getClientHomeHandler = async (req: Request, res: Response) => {
  try {
    return res.status(200).json(await getClientHome(req.userId as string));
  } catch (error) {
    console.error('Error fetching client home:', error);
    return res.status(500).json({ message: 'Error fetching client home' });
  }
};

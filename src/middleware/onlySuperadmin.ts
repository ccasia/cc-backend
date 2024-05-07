import { Request, Response, NextFunction } from 'express';
import { getUser } from 'src/service/userServices';

export const isSuperAdmin = async (req: Request, res: Response, next: NextFunction) => {
  const userid = req.session.userid;

  if (!userid) {
    return res.status(404).json({ message: 'forbidden' });
  }

  try {
    const user = await getUser(userid);
    if (user?.admin?.mode !== 'god') {
      return res.status(404).json({ message: 'forbidden' });
    }
  } catch (error) {
    return res.status(400).json({ message: error });
  }
  next();
};

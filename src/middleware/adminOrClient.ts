import { Request, Response, NextFunction } from 'express';
import { getUser } from '@services/userServices';

export const isAdminOrClient = async (req: Request, res: Response, next: NextFunction) => {
  const userid = req.session.userid;

  if (!userid) {
    return res.status(404).json({ message: 'forbidden' });
  }

  try {
    const user = await getUser(userid);
    
    // Allow if user is admin (god, normal, advanced)
    if (['god', 'normal', 'advanced'].some((elem) => elem.includes(user?.admin?.mode as string))) {
      return next();
    }
    
    // Allow if user is client
    if (user?.role === 'client') {
      return next();
    }
    
    return res.status(404).json({ message: 'forbidden' });
  } catch (error) {
    return res.status(400).json({ message: error });
  }
};
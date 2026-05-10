import { NextFunction, Request, Response } from 'express';

export const isLoggedIn = async (req: Request, res: Response, next: NextFunction) => {
  const { userid } = req.session as any;

  if (!userid) {
    return res.status(403).json({ message: 'Forbidden' });
  }

  next();
};

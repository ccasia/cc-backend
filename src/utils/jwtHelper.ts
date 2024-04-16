import { Response, NextFunction } from 'express';
import { verify } from 'jsonwebtoken';

export const validateToken = (req: any, res: Response, next: NextFunction) => {
  const accessToken = req.cookies['accessToken'];
  //const refeshToken = req.cookies["token"]

  if (!accessToken) return res.status(400).json({ error: 'User not Authenticated!' });

  try {
    const validToken = verify(accessToken, process.env.ACCESSKEY as string);
    if (validToken) {
      req.authenticated = true;
      req.user = validToken;
      return next();
    }
  } catch (err) {
    return res.status(400).json({ error: err });
  }
};

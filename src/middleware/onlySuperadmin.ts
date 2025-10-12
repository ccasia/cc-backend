import { Request, Response, NextFunction } from 'express';
import { getUser } from '@services/userServices';

export const isSuperAdmin = async (req: Request, res: Response, next: NextFunction) => {
  const userid = req.session.userid;

  if (!userid) {
    return res.status(404).json({ message: 'forbidden' });
  }

  try {
    const user = await getUser(userid);
    if (!['god', 'normal', 'advanced'].some((elem) => elem.includes(user?.admin?.mode as string))) {
      return res.status(404).json({ message: 'forbidden' });
    }
  } catch (error) {
    return res.status(400).json({ message: error });
  }
  next();
};

export const isAdmin = async (req: Request, res: Response, next: NextFunction) => {
  const userid = req.session.userid;

  if (!userid) {
    return res.status(401).json({ message: 'User not authenticated' });
  }

  try {
    const user = await getUser(userid);
    
    // Allow both admin and superadmin roles
    if (user?.role !== 'admin' && user?.role !== 'superadmin') {
      return res.status(403).json({ message: 'Access denied. Admin role required.' });
    }
    
    // Check if user is a superadmin (god or advanced mode)
    const isSuperAdmin = user?.role === 'superadmin' || ['god', 'advanced'].includes(user?.admin?.mode || '');
    
    // If user is superadmin, allow access
    if (isSuperAdmin) {
      return next();
    }
    
    // For non-superadmins, check if they have CSM role
    const isCSM = user?.admin?.role?.name === 'CSM' || 
                 user?.admin?.role?.name === 'Customer Success Manager' ||
                 (user?.admin?.role?.name || '').toLowerCase().includes('csm') ||
                 (user?.admin?.role?.name || '').toLowerCase().includes('customer success');
    
    if (!isCSM) {
      return res.status(403).json({ message: 'Access denied. Superadmin or CSM role required.' });
    }
    
    next();
  } catch (error) {
    console.error('Error in isAdmin middleware:', error);
    return res.status(500).json({ message: 'Internal server error checking permissions' });
  }
};

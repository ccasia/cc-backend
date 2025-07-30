import { Request, Response, NextFunction } from 'express';
import { getUser } from '@services/userServices';

export const isAdminOrClient = async (req: Request, res: Response, next: NextFunction) => {
  const userid = req.session.userid;

  if (!userid) {
    return res.status(401).json({ message: 'User not authenticated' });
  }

  try {
    const user = await getUser(userid);

    const role = user?.role?.toLowerCase();

    if (role !== 'admin' && role !== 'client' && role !== 'superadmin') {
      console.log('SADSAD');
      return res.status(403).json({ message: 'Access denied. Admin, superadmin, or client role required.' });
    }
  } catch (error) {
    return res.status(400).json({ message: error });
  }
  next();
};

export const canActivateCampaign = async (req: Request, res: Response, next: NextFunction) => {
  const userid = req.session.userid;

  if (!userid) {
    return res.status(401).json({ message: 'User not authenticated' });
  }

  try {
    const user = await getUser(userid);
    console.log('User attempting to activate campaign:', {
      userId: user?.id,
      role: user?.role,
      adminMode: user?.admin?.mode,
      adminRoleId: user?.admin?.roleId,
    });

    // Check if user has admin or superadmin role
    if (user?.role !== 'admin' && user?.role !== 'superadmin') {
      return res.status(403).json({ message: 'Access denied. Admin role required.' });
    }

    // If user is superadmin role, allow access
    if (user?.role === 'superadmin') {
      console.log('Access granted: User has superadmin role');
      return next();
    }

    // Check if user is a superadmin (god or advanced mode)
    const isSuperAdmin = ['god', 'advanced'].includes(user?.admin?.mode || '');

    // If user is superadmin mode, allow access
    if (isSuperAdmin) {
      console.log('Access granted: User has superadmin mode');
      return next();
    }

    // For now, just allow all admin users to activate campaigns
    console.log('Access granted: User is admin');
    return next();
  } catch (error) {
    console.error('Error in canActivateCampaign middleware:', error);
    return res.status(500).json({ message: 'Internal server error checking permissions' });
  }
};

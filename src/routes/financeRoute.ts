import { Request, Response, NextFunction, Router } from 'express';
import {
  getFinanceDashboard,
  getFinanceInvoicesController,
  getNewPackageClientsController,
  getClientCampaignBreakdownController,
} from '@controllers/financeController';
import { authenticate } from '@middlewares/authenticate';
import { getUser } from '@services/userServices';

// Any admin sub-role may view finance data — matches the frontend
// RoleBasedGuard roles={['admin']} on /dashboard/finance. (The shared isAdmin
// middleware only passes superadmins and CSMs, which would 403 Finance admins.)
const isAnyAdmin = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await getUser(req.userId as string);

    if (user?.role !== 'admin' && user?.role !== 'superadmin') {
      return res.status(403).json({ message: 'Access denied. Admin role required.' });
    }

    return next();
  } catch (error) {
    console.error('Error in isAnyAdmin middleware:', error);
    return res.status(500).json({ message: 'Internal server error checking permissions' });
  }
};

const router = Router();

router.get('/dashboard', authenticate, isAnyAdmin, getFinanceDashboard);
router.get('/invoices', authenticate, isAnyAdmin, getFinanceInvoicesController);
router.get('/new-clients', authenticate, isAnyAdmin, getNewPackageClientsController);
router.get('/client/:companyId/campaign-breakdown', authenticate, isAnyAdmin, getClientCampaignBreakdownController);

export default router;

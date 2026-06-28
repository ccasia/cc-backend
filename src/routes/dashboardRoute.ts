import { Router } from 'express';
import {
  getDashboardStats,
  getDashboardCampaigns,
  getDashboardAttention,
  getDashboardNewlyApproved,
  getDashboardAgreementsPending,
  getDashboardDraftsPending,
  getDashboardPitchesPending,
  getDashboardLinksPending,
  getDashboardClientFeedbacks,
  getDashboardOverdueInvoices,
} from '@controllers/dashboardController';
import { authenticate } from '@middlewares/authenticate';

const router = Router();

router.get('/stats', authenticate, getDashboardStats);
router.get('/campaigns', authenticate, getDashboardCampaigns);
router.get('/attention', authenticate, getDashboardAttention);
router.get('/newly-approved', authenticate, getDashboardNewlyApproved);
router.get('/agreements-pending', authenticate, getDashboardAgreementsPending);
router.get('/drafts-pending', authenticate, getDashboardDraftsPending);
router.get('/pitches-pending', authenticate, getDashboardPitchesPending);
router.get('/links-pending', authenticate, getDashboardLinksPending);
router.get('/client-feedbacks', authenticate, getDashboardClientFeedbacks);
router.get('/overdue-invoices', authenticate, getDashboardOverdueInvoices);

export default router;

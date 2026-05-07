import express from 'express';
import { authenticate } from '@middlewares/onlyLogin';
import { isCreator } from '@middlewares/isCreator';
import { isAdminOrClient } from '@middlewares/adminOrClient';
import { isSuperAdmin } from '@middlewares/onlySuperadmin';
import { checkCampaignAccess } from '@middlewares/checkCampaignAccess';

import {
  getCreatorLogistics,
  getLogisticsForCampaign,
  getCreatorLogisticForCampaign,
  getProductsForCampaign,
  createProduct,
  singleAssignmentLogistics,
  bulkAssignmentLogistics,
  scheduleDelivery,
  deleteProduct,
  updateCreatorDeliveryDetails,
  markLogisticReceived,
  reportIssue,
  updateLogisticStatus,
  adminUpdateLogisticDetails,
  resolveLogisticIssue,
  retryLogisticDelivery,
  submitCreatorProductInfo,
  upsertReservationConfig,
  getReservationConfig,
  getReservationSlots,
  submitReservationDetails,
  scheduleReservation,
  rescheduleReservation,
  markLogisticCompleted,
  updateReservationDetails,
  adminSchedule,
} from '@controllers/logisticsController';

const router = express.Router();

// creator routes
router.get('/me', authenticate, isCreator, getCreatorLogistics); // maybe no need
router.get('/creator/campaign/:campaignId', authenticate, isCreator, getCreatorLogisticForCampaign);
router.patch('/creator/:logisticId/details', authenticate, isCreator, updateCreatorDeliveryDetails);
router.patch('/creator/:logisticId/received', authenticate, isCreator, markLogisticReceived);
router.post('/creator/:logisticId/issue', authenticate, isCreator, reportIssue);
router.post('/creator/campaign/:campaignId/onboarding-details', authenticate, isCreator, submitCreatorProductInfo);

// admin & client routes
router.get(
  '/campaign/:campaignId',
  authenticate,
  isAdminOrClient,
  isSuperAdmin,
  checkCampaignAccess,
  getLogisticsForCampaign,
);

// product specific routes
router.get(
  '/products/campaign/:campaignId',
  authenticate,
  isAdminOrClient,
  checkCampaignAccess,
  getProductsForCampaign,
);
router.post('/products/:campaignId', authenticate, isAdminOrClient, checkCampaignAccess, createProduct);
router.delete('/products/:productId', authenticate, isAdminOrClient, deleteProduct);

router.post('/bulk-assign/:campaignId', authenticate, isAdminOrClient, checkCampaignAccess, bulkAssignmentLogistics);
router.post('/assign/:campaignId', authenticate, isAdminOrClient, checkCampaignAccess, singleAssignmentLogistics);
router.patch(
  '/campaign/:campaignId/:logisticId/schedule',
  authenticate,
  isAdminOrClient,
  checkCampaignAccess,
  scheduleDelivery,
);
router.patch(
  '/campaign/:campaignId/:logisticId/resolve',
  authenticate,
  isAdminOrClient,
  checkCampaignAccess,
  resolveLogisticIssue,
);
router.patch(
  '/campaign/:campaignId/:logisticId/retry',
  authenticate,
  isAdminOrClient,
  checkCampaignAccess,
  retryLogisticDelivery,
);
router.patch('/admin/:logisticId/status', authenticate, isAdminOrClient, updateLogisticStatus);
router.put('/admin/:logisticId/details', authenticate, isAdminOrClient, adminUpdateLogisticDetails);

// ------------------reservation routes--------------------------

// creator routes
router.get('/campaign/:campaignId/slots', authenticate, getReservationSlots);
router.post('/campaign/:campaignId/reservation', authenticate, isCreator, submitReservationDetails);
router.patch('/creator/:logisticId/complete', authenticate, isCreator, markLogisticCompleted);

// admin & client routes
router.get('/campaign/:campaignId/reservation-config', authenticate, getReservationConfig);
router.post(
  '/campaign/:campaignId/reservation-config',
  authenticate,
  isAdminOrClient,
  checkCampaignAccess,
  upsertReservationConfig,
);
router.post('/campaign/:campaignId/:logisticId/reschedule', authenticate, rescheduleReservation);
router.patch(
  '/campaign/:campaignId/:logisticId/reservation-detail',
  authenticate,
  isAdminOrClient,
  checkCampaignAccess,
  updateReservationDetails,
);

router.patch(
  '/campaign/:campaignId/:logisticId/schedule-reservation',
  authenticate,
  isAdminOrClient,
  checkCampaignAccess,
  scheduleReservation,
);
router.patch('/campaign/:campaignId/:logisticId/admin-schedule', authenticate, isAdminOrClient, adminSchedule);

export default router;

import express from 'express';
import { isLoggedIn } from '@middlewares/onlyLogin';
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
router.get('/me', isLoggedIn, isCreator, getCreatorLogistics); // maybe no need
router.get('/creator/campaign/:campaignId', isLoggedIn, isCreator, getCreatorLogisticForCampaign);
router.patch('/creator/:logisticId/details', isLoggedIn, isCreator, updateCreatorDeliveryDetails);
router.patch('/creator/:logisticId/received', isLoggedIn, isCreator, markLogisticReceived);
router.post('/creator/:logisticId/issue', isLoggedIn, isCreator, reportIssue);
router.post('/creator/campaign/:campaignId/onboarding-details', isLoggedIn, isCreator, submitCreatorProductInfo);

// admin & client routes
router.get(
  '/campaign/:campaignId',
  isLoggedIn,
  isAdminOrClient,
  isSuperAdmin,
  checkCampaignAccess,
  getLogisticsForCampaign,
);

// product specific routes
router.get('/products/campaign/:campaignId', isLoggedIn, isAdminOrClient, checkCampaignAccess, getProductsForCampaign);
router.post('/products/:campaignId', isLoggedIn, isAdminOrClient, checkCampaignAccess, createProduct);
router.delete('/products/:productId', isLoggedIn, isAdminOrClient, deleteProduct);

router.post('/bulk-assign/:campaignId', isLoggedIn, isAdminOrClient, checkCampaignAccess, bulkAssignmentLogistics);
router.post('/assign/:campaignId', isLoggedIn, isAdminOrClient, checkCampaignAccess, singleAssignmentLogistics);
router.patch(
  '/campaign/:campaignId/:logisticId/schedule',
  isLoggedIn,
  isAdminOrClient,
  checkCampaignAccess,
  scheduleDelivery,
);
router.patch(
  '/campaign/:campaignId/:logisticId/resolve',
  isLoggedIn,
  isAdminOrClient,
  checkCampaignAccess,
  resolveLogisticIssue,
);
router.patch(
  '/campaign/:campaignId/:logisticId/retry',
  isLoggedIn,
  isAdminOrClient,
  checkCampaignAccess,
  retryLogisticDelivery,
);
router.patch('/admin/:logisticId/status', isLoggedIn, isAdminOrClient, updateLogisticStatus);
router.put('/admin/:logisticId/details', isLoggedIn, isAdminOrClient, adminUpdateLogisticDetails);

// ------------------reservation routes--------------------------

// creator routes
router.get('/campaign/:campaignId/slots', isLoggedIn, getReservationSlots);
router.post('/campaign/:campaignId/reservation', isLoggedIn, isCreator, submitReservationDetails);
router.patch('/creator/:logisticId/complete', isLoggedIn, isCreator, markLogisticCompleted);

// admin & client routes
router.get('/campaign/:campaignId/reservation-config', isLoggedIn, getReservationConfig);
router.post(
  '/campaign/:campaignId/reservation-config',
  isLoggedIn,
  isAdminOrClient,
  checkCampaignAccess,
  upsertReservationConfig,
);
router.post('/campaign/:campaignId/:logisticId/reschedule', isLoggedIn, rescheduleReservation);
router.patch(
  '/campaign/:campaignId/:logisticId/reservation-detail',
  isLoggedIn,
  isAdminOrClient,
  checkCampaignAccess,
  updateReservationDetails,
);

router.patch(
  '/campaign/:campaignId/:logisticId/schedule-reservation',
  isLoggedIn,
  isAdminOrClient,
  checkCampaignAccess,
  scheduleReservation,
);
router.patch('/campaign/:campaignId/:logisticId/admin-schedule', isLoggedIn, isAdminOrClient, adminSchedule);

export default router;

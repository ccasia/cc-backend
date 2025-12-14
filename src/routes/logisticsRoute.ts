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
  submitReservation,
  confirmReservation,
  rescheduleReservation,
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
router.get('/campaign/:campaignId/slots', isLoggedIn, isAdminOrClient, getReservationSlots);
router.post('/campaign/:campaignId/reservation', isLoggedIn, isCreator, submitReservation);

// admin & client routes
router.get(
  '/campaign/:campaignId/reservation-config',
  isLoggedIn,
  isAdminOrClient,
  checkCampaignAccess,
  getReservationConfig,
);
router.post(
  '/campaign/:campaignId/reservation-config',
  isLoggedIn,
  isAdminOrClient,
  checkCampaignAccess,
  upsertReservationConfig,
);
router.patch(
  '/campaign/:campaignId/:logisticId/confirm-reservation',
  isLoggedIn,
  isAdminOrClient,
  checkCampaignAccess,
  confirmReservation,
);
router.post(
  '/campaign/:campaignId/:logisticIscm-history-item:/Users/ccdeveloper/cc/cc-backend?%7B%22repositoryId%22%3A%22scm0%22%2C%22historyItemId%22%3A%2264fe4d2777cf0ddbae82eb577b213975ead3907d%22%2C%22historyItemParentId%22%3A%229e1b9e77dc26cbef2e7d3fd83fd03282ecaa7823%22%2C%22historyItemDisplayId%22%3A%2264fe4d2%22%7Dd/reschedule',
  isLoggedIn,
  isAdminOrClient, // Creator might need this too depending on your logic
  rescheduleReservation,
);

export default router;

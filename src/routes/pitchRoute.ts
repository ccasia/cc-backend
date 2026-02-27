import express from 'express';
import { isLoggedIn } from '@middlewares/onlyLogin';
import { isAdminOrClient } from '@middlewares/adminOrClient';
import {
  approvePitchByAdmin,
  rejectPitchByAdmin,
  approvePitchByClient,
  rejectPitchByClient,
  maybePitchByClient,
  setPitchAgreement,
  submitAgreement,
  getPitchesV3,
  getPitchByIdV3,
  updateGuestCreatorInfo,
  withdrawCreatorFromCampaign,
  updateOutreachStatus,
  acceptInviteByCreator,
} from '@controllers/pitchController';

const router = express.Router();

// V3 Flow Routes
router.get('/v3', isLoggedIn, getPitchesV3);
router.get('/v3/:pitchId', isLoggedIn, getPitchByIdV3);
router.patch('/v3/:pitchId/approve', isLoggedIn, isAdminOrClient, approvePitchByAdmin);
router.patch('/v3/:pitchId/reject', isLoggedIn, isAdminOrClient, rejectPitchByAdmin);
router.patch('/v3/:pitchId/approve/client', isLoggedIn, isAdminOrClient, approvePitchByClient);
router.patch('/v3/:pitchId/reject/client', isLoggedIn, isAdminOrClient, rejectPitchByClient);
router.patch('/v3/:pitchId/maybe/client', isLoggedIn, isAdminOrClient, maybePitchByClient);
router.patch('/v3/:pitchId/agreement', isLoggedIn, isAdminOrClient, setPitchAgreement);
router.patch('/v3/:pitchId/submit-agreement', isLoggedIn, submitAgreement);
router.patch('/v3/:pitchId/updateGuest', isLoggedIn, isAdminOrClient, updateGuestCreatorInfo);
router.patch('/v3/:pitchId/withdraw', isLoggedIn, isAdminOrClient, withdrawCreatorFromCampaign);
router.patch('/v3/:pitchId/outreach-status', isLoggedIn, isAdminOrClient, updateOutreachStatus);
router.patch('/v3/:pitchId/accept-invite', isLoggedIn, acceptInviteByCreator);

export default router;

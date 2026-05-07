import express from 'express';
import { authenticate } from '@middlewares/onlyLogin';
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
router.get('/v3', authenticate, getPitchesV3);
router.get('/v3/:pitchId', authenticate, getPitchByIdV3);
router.patch('/v3/:pitchId/approve', authenticate, isAdminOrClient, approvePitchByAdmin);
router.patch('/v3/:pitchId/reject', authenticate, isAdminOrClient, rejectPitchByAdmin);
router.patch('/v3/:pitchId/approve/client', authenticate, isAdminOrClient, approvePitchByClient);
router.patch('/v3/:pitchId/reject/client', authenticate, isAdminOrClient, rejectPitchByClient);
router.patch('/v3/:pitchId/maybe/client', authenticate, isAdminOrClient, maybePitchByClient);
router.patch('/v3/:pitchId/agreement', authenticate, isAdminOrClient, setPitchAgreement);
router.patch('/v3/:pitchId/submit-agreement', authenticate, submitAgreement);
router.patch('/v3/:pitchId/updateGuest', authenticate, isAdminOrClient, updateGuestCreatorInfo);
router.patch('/v3/:pitchId/withdraw', authenticate, isAdminOrClient, withdrawCreatorFromCampaign);
router.patch('/v3/:pitchId/outreach-status', authenticate, isAdminOrClient, updateOutreachStatus);
router.patch('/v3/:pitchId/accept-invite', authenticate, acceptInviteByCreator);

export default router;

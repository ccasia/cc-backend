import { Router } from 'express';
import rateLimit from 'express-rate-limit';

import { isBdOrSuperadmin } from '../middleware/onlySuperadmin';
import {
  getMyInviteLink,
  rotateMyInviteLink,
  getPublicInviteInfo,
  bdSubmitDraft,
  // BD-authored brief flow
  createBrief,
  listBriefs,
  getBrief,
  patchBrief,
  sendBriefToClient,
  approveBrief,
  handoverBrief,
  assignCsm,
  deleteBrief,
  uploadBriefAttachment,
  uploadBriefAttachmentPublic,
  deleteBriefAttachment,
  deleteBriefAttachmentPublic,
  // Client magic-link flow
  getBriefPublic,
  patchBriefPublic,
  approveBriefPublic,
} from '@controllers/campaignBriefController';
import { authenticate } from '../middleware/authenticate';

const router = Router();

const publicLookupLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests, try again in a moment.' },
});

const publicSubmitLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many submissions, please slow down.' },
});

const publicPatchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many edits, please slow down.' },
});

// --- Existing CLIENT_INVITED (BD share-link) flow ---
router.get('/my-invite-link', authenticate, isBdOrSuperadmin, getMyInviteLink);
router.post('/my-invite-link/rotate', authenticate, isBdOrSuperadmin, rotateMyInviteLink);

router.get('/invite/public/:token', publicLookupLimiter, getPublicInviteInfo);
router.post('/invite/public/:token/submit', publicSubmitLimiter, bdSubmitDraft);

// --- New BD-authored brief flow ---
router.post('/', authenticate, isBdOrSuperadmin, createBrief);
router.get('/', authenticate, isBdOrSuperadmin, listBriefs);
router.get('/:id', authenticate, isBdOrSuperadmin, getBrief);
router.patch('/:id', authenticate, isBdOrSuperadmin, patchBrief);
router.post('/:id/send', authenticate, isBdOrSuperadmin, sendBriefToClient);
router.post('/:id/approve', authenticate, isBdOrSuperadmin, approveBrief);
router.post('/:id/handover', authenticate, isBdOrSuperadmin, handoverBrief);
// CSL-only assignment of CSMs to a handed-over campaign (controller enforces
// the CSL/superadmin role; isBdOrSuperadmin already admits CSL).
router.post('/:id/assign-csm', authenticate, isBdOrSuperadmin, assignCsm);
router.post('/:id/attachments', authenticate, isBdOrSuperadmin, uploadBriefAttachment);
router.delete('/:id/attachments', authenticate, isBdOrSuperadmin, deleteBriefAttachment);
router.delete('/:id', authenticate, isBdOrSuperadmin, deleteBrief);

// --- Public (magic-link) client review/edit/approve endpoints ---
router.get('/public/:magicToken', publicLookupLimiter, getBriefPublic);
router.patch('/public/:magicToken', publicPatchLimiter, patchBriefPublic);
router.post('/public/:magicToken/approve', publicSubmitLimiter, approveBriefPublic);
router.post('/public/:magicToken/attachments', publicSubmitLimiter, uploadBriefAttachmentPublic);
router.delete('/public/:magicToken/attachments', publicPatchLimiter, deleteBriefAttachmentPublic);

export default router;

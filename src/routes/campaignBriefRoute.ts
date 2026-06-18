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
  resetBrief,
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
import { isLoggedIn } from '../middleware/onlyLogin';

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
router.get('/my-invite-link', isLoggedIn, isBdOrSuperadmin, getMyInviteLink);
router.post('/my-invite-link/rotate', isLoggedIn, isBdOrSuperadmin, rotateMyInviteLink);

router.get('/invite/public/:token', publicLookupLimiter, getPublicInviteInfo);
router.post('/invite/public/:token/submit', publicSubmitLimiter, bdSubmitDraft);

// --- New BD-authored brief flow ---
router.post('/', isLoggedIn, isBdOrSuperadmin, createBrief);
router.get('/', isLoggedIn, isBdOrSuperadmin, listBriefs);
router.get('/:id', isLoggedIn, isBdOrSuperadmin, getBrief);
router.patch('/:id', isLoggedIn, isBdOrSuperadmin, patchBrief);
router.post('/:id/send', isLoggedIn, isBdOrSuperadmin, sendBriefToClient);
router.post('/:id/approve', isLoggedIn, isBdOrSuperadmin, approveBrief);
router.post('/:id/reset', isLoggedIn, isBdOrSuperadmin, resetBrief);
router.post('/:id/handover', isLoggedIn, isBdOrSuperadmin, handoverBrief);
// CSL-only assignment of CSMs to a handed-over campaign (controller enforces
// the CSL/superadmin role; isBdOrSuperadmin already admits CSL).
router.post('/:id/assign-csm', isLoggedIn, isBdOrSuperadmin, assignCsm);
router.post('/:id/attachments', isLoggedIn, isBdOrSuperadmin, uploadBriefAttachment);
router.delete('/:id/attachments', isLoggedIn, isBdOrSuperadmin, deleteBriefAttachment);
router.delete('/:id', isLoggedIn, isBdOrSuperadmin, deleteBrief);

// --- Public (magic-link) client review/edit/approve endpoints ---
router.get('/public/:magicToken', publicLookupLimiter, getBriefPublic);
router.patch('/public/:magicToken', publicPatchLimiter, patchBriefPublic);
router.post('/public/:magicToken/approve', publicSubmitLimiter, approveBriefPublic);
router.post('/public/:magicToken/attachments', publicSubmitLimiter, uploadBriefAttachmentPublic);
router.delete('/public/:magicToken/attachments', publicPatchLimiter, deleteBriefAttachmentPublic);

export default router;

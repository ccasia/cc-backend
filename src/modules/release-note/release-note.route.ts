import { Router } from 'express';
import { authenticate } from '@middlewares/authenticate';
import { isAnyAdmin, isSuperAdmin } from '@middlewares/onlySuperadmin';
import {
  createReleaseNoteHandler,
  deleteReleaseNoteHandler,
  getAllReleaseNotesHandler,
  getPublishedReleaseNotesHandler,
  getUnseenReleaseNoteHandler,
  markReleaseNotesSeenHandler,
  updateReleaseNoteHandler,
} from './release-note.controller';

const router = Router();

router.use(authenticate);

// All admins — static paths must stay above /:id
router.get('/unseen', isAnyAdmin, getUnseenReleaseNoteHandler);
router.post('/seen', isAnyAdmin, markReleaseNotesSeenHandler);
router.get('/manage', isSuperAdmin, getAllReleaseNotesHandler);
router.get('/', isAnyAdmin, getPublishedReleaseNotesHandler);

// Superadmin only
router.post('/', isSuperAdmin, createReleaseNoteHandler);
router.patch('/:id', isSuperAdmin, updateReleaseNoteHandler);
router.delete('/:id', isSuperAdmin, deleteReleaseNoteHandler);

export default router;

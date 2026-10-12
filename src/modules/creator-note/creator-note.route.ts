import { Router } from 'express';
import { authenticate } from '@middlewares/authenticate';
import {
  createNoteHandler,
  getSummaryHandler,
  getThreadHandler,
  markReadHandler,
  requireNotesAccess,
  setFollowingHandler,
  setPinnedHandler,
} from './creator-note.controller';

// Mounted at /campaign/:campaignId/creator-notes
const router = Router({ mergeParams: true });

router.use(authenticate, requireNotesAccess);

router.get('/summary', getSummaryHandler);
router.get('/:creatorId', getThreadHandler);
router.post('/:creatorId', createNoteHandler);
router.patch('/:creatorId/notes/:noteId/pin', setPinnedHandler);
router.post('/:creatorId/read', markReadHandler);
router.put('/:creatorId/follow', setFollowingHandler);

export default router;

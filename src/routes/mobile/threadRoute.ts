import { Router } from 'express';

import { authenticate } from '@middlewares/authenticate';
import {
  deleteMyMessage,
  editMyMessage,
  getThreadLinkPreview,
  getMyThreads,
  getMyThreadMessages,
  markThreadSeen,
  sendMyMessage,
  startDirectThread,
} from '@controllers/mobileThreadController';
import { archiveThread, unarchiveThread } from '@controllers/threadController';

const router = Router();

router.get('/threads', authenticate, getMyThreads);
router.get('/link-preview', authenticate, getThreadLinkPreview);
router.post('/start', authenticate, startDirectThread);
router.get('/:threadId/messages', authenticate, getMyThreadMessages);
router.post('/:threadId/send', authenticate, sendMyMessage);
router.put('/:threadId/messages/:messageId', authenticate, editMyMessage);
router.delete('/:threadId/messages/:messageId', authenticate, deleteMyMessage);
router.put('/:threadId/seen', authenticate, markThreadSeen);
router.put('/:threadId/archive', authenticate, archiveThread);
router.put('/:threadId/unarchive', authenticate, unarchiveThread);

export default router;

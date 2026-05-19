import { Router } from 'express';

import { authenticate } from '@middlewares/authenticate';
import {
  getThreadLinkPreview,
  getMyThreads,
  getMyThreadMessages,
  markThreadSeen,
  sendMyMessage,
} from '@controllers/mobileThreadController';
import { archiveThread, unarchiveThread } from '@controllers/threadController';

const router = Router();

router.get('/threads', authenticate, getMyThreads);
router.get('/link-preview', authenticate, getThreadLinkPreview);
router.get('/:threadId/messages', authenticate, getMyThreadMessages);
router.post('/:threadId/send', authenticate, sendMyMessage);
router.put('/:threadId/seen', authenticate, markThreadSeen);
router.put('/:threadId/archive', authenticate, archiveThread);
router.put('/:threadId/unarchive', authenticate, unarchiveThread);

export default router;

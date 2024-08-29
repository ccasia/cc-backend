import { Router } from 'express';
import {
  createThread,
  addUserToThread,
  getMessagesFromThread,
  sendMessageInThread,
  getAllThreads,
  getUserThreads,
  // messagewithThreads,
  archiveThread,
  unarchiveThread,
  // fetchExistingSingleChat,
  getThreadById,
  getUnreadMessageCount,
  markMessagesAsSeen,
  getTotalUnreadMessageCount,
} from '.@controllers/threadController';

const router = Router();

// Create thread

router.post('/createthread', createThread);

// View threads
router.get('/threads', getAllThreads);
router.get('/:threadId', getThreadById);
router.get('/userthreads', getUserThreads);
// router.get('/threads/:threadId', messagewithThreads);
// router.get('/single', fetchExistingSingleChat);

// add user
router.post('/adduser', addUserToThread);

// Send a new message
router.post('/send', sendMessageInThread);

// Get messages between users for group chat & 1 on 1
router.get('/getmessage/:threadId', getMessagesFromThread);

// Get unread message count for the current user
router.get('/:threadId/unreadcount', getUnreadMessageCount);
router.get('/message/totalcount', getTotalUnreadMessageCount);
// Mark messages as seen
router.put('/:threadId/seen', markMessagesAsSeen);

// Un- Archive
router.put('/:threadId/unarchive', unarchiveThread);

// Archive
router.put('/:threadId/archive', archiveThread);

export default router;

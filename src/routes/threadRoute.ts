import { Router } from 'express';
import {
  createThread,
  addUserToThread,
  getMessagesFromThread,
  sendMessageInThread,
  getAllThreads,
  getUserThreads,
  messagewithThreads,
  archiveThread,
  unarchiveThread,
  fetchExistingSingleChat,
  getThreadById,
} from '../controller/threadController';

const router = Router();

// Create thread

router.post('/createthread', createThread);

// View threads
router.get('/threads', getAllThreads);
router.get('/:threadId', getThreadById);
router.get('/userthreads', getUserThreads);
router.get('/threads/:threadId', messagewithThreads);
router.get('/single', fetchExistingSingleChat);

// add user
router.post('/adduser', addUserToThread);

// Send a new message
router.post('/send', sendMessageInThread);

// Get messages between users for group chat & 1 on 1
router.get('/getmessage/:threadId', getMessagesFromThread);

// Mark a message as read
// router.put('/:messageId/read', markAsRead);

// Un- Archive
router.put('/threads/:threadId/unarchive', unarchiveThread);

// Archive
router.put('/threads/:threadId/archive', archiveThread);

export default router;

import { Router } from 'express';
import { archiveAll, getNotificationByUserId, markAllAsRead, markAsRead } from '@controllers/notificationController';
import { authenticate } from '../middleware/authenticate';

const router = Router();

router.use(authenticate);
router.get('/', getNotificationByUserId);
router.patch('/markRead', markAllAsRead);
router.patch('/archiveAll', archiveAll);
router.patch('/:id/mark-read', markAsRead);

// router.post('/approveOrReject', approveOrReject);
// router.get('/:id/notification', getAllNotification);

export default router;

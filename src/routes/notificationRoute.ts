import { Router } from 'express';
import { getNotificationByUserId, markAllAsRead } from 'src/controller/notificationController';

const router = Router();

router.get('/', getNotificationByUserId);
router.patch('/markRead', markAllAsRead);

// router.post('/approveOrReject', approveOrReject);
// router.get('/:id/notification', getAllNotification);

export default router;

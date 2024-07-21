import { Router } from 'express';
import { archiveAll, getNotificationByUserId, markAllAsRead } from 'src/controller/notificationController';

const router = Router();

router.get('/', getNotificationByUserId);
router.patch('/markRead', markAllAsRead);
router.patch('/archiveAll', archiveAll);

// router.post('/approveOrReject', approveOrReject);
// router.get('/:id/notification', getAllNotification);

export default router;

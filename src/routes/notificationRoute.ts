import { Router } from "express";

import { getNotificationsByIdController, createNotificationController } from "../controller/notificationController";

const router = Router();

router.get('/', getNotificationsByIdController);
router.post('/createNotification', createNotificationController);

export default router;
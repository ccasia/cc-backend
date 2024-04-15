import { Router } from 'express';
import { updateProfile } from 'src/controller/userController';

const router = Router();

router.patch('/updateProfile', updateProfile);
// router.post('/approveOrReject', approveOrReject);
// router.get('/:id/notification', getAllNotification);

export default router;

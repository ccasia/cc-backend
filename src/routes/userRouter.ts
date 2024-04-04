import { Router } from 'express';
import { updateProfile } from 'src/controller/userController';

const router = Router();

router.patch('/updateProfile', updateProfile);

export default router;

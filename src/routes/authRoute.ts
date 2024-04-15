import { Router } from 'express';
import { registerUser,registerAdmin, login ,displayAll ,sendEmail ,registerCreator ,registerSuperAdmin} from '../controller/authController';

const router = Router();
router.get('/', displayAll);
router.post('/login', login);
router.post('/register', registerUser);
router.post('/registerAdmin', registerAdmin);
router.post('/adminEmail', sendEmail);
router.post('/registerCreator', registerCreator);
router.post('/registerSuperAdmin' ,registerSuperAdmin);
export default router;

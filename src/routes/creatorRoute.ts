import { Router } from 'express';
// import { validateToken } from '@utils/jwtHelper';
import { getCreators, deleteCreator } from '../controller/creatorController';
import { isSuperAdmin } from 'src/middleware/onlySuperadmin';
const router = Router();

router.get('/getAll', isSuperAdmin, getCreators);
router.delete('/delete/:id', isSuperAdmin, deleteCreator);

export default router;
